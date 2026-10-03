"""Retarget cleaned MediaPipe landmarks onto Luke's canonical 17-bone rig.

Only bone *directions* are taken from the video, never segment lengths, so
Luke's supplied proportions are untouched. Every Luke rest local rotation is
identity (docs/rig/luke-rig-contract.json), so a bone's world rotation is the
rotation that carries its rest frame onto the observed frame, and its glTF
local rotation is parent_world^-1 * world.

Cleanup applied here:
  * per-landmark Hampel outlier rejection, visibility-weighted gap filling
  * zero-phase Butterworth low-pass (separate cutoffs for body and hands)
  * overhead-arm depth-flip prior (forward_arm_prior)
  * camera yaw/pan removal (gameplay owns facing) and camera pitch levelling
  * hinge-plane continuity for elbows/knees when limbs are nearly straight
  * planned hand orientation on the tracked forearm (see HAND_PRESETS)
  * joint limits on wrists, neck and head; quaternion sign continuity

usage: python3 retarget_luke.py POSE.json OUT.json [--hand-plan JSON]
"""
import argparse, json, os
import numpy as np
from scipy.signal import butter, filtfilt
from scipy.spatial.transform import Rotation as R, Slerp

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACT = os.path.join(HERE, '..', '..', 'docs', 'rig', 'luke-rig-contract.json')
L = dict(nose=0, l_ear=7, r_ear=8, l_sh=11, r_sh=12, l_el=13, r_el=14, l_wr=15, r_wr=16, l_pinky=17, r_pinky=18,
         l_index=19, r_index=20, l_thumb=21, r_thumb=22, l_hip=23, r_hip=24, l_knee=25, r_knee=26,
         l_ank=27, r_ank=28, l_heel=29, r_heel=30, l_toe=31, r_toe=32)
BONES = ['root', 'pelvis', 'chest', 'left_upper_arm', 'left_forearm', 'left_hand', 'neck', 'head', 'right_upper_arm',
         'right_forearm', 'right_hand', 'left_thigh', 'left_shin', 'left_foot', 'right_thigh', 'right_shin', 'right_foot']
FWD = np.array([0., 0., -1.]); UP = np.array([0., 1., 0.]); RIGHT = np.array([1., 0., 0.])

def unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-9)

def frame(primary, secondary):
    """Orthonormal basis (columns) with x=primary, y~secondary."""
    x = unit(primary); z = unit(np.cross(x, secondary)); y = np.cross(z, x)
    return np.stack([x, y, z], axis=-1)

def rest_positions():
    bones = json.load(open(CONTRACT))['bones']
    return {b['name']: np.array(b['worldRestMatrix'][12:15]) for b in bones}

def hampel(x, k=3, t=3.0):
    y = x.copy()
    for i in range(len(x)):
        lo, hi = max(0, i - k), min(len(x), i + k + 1)
        med = np.median(x[lo:hi], axis=0); mad = np.median(np.abs(x[lo:hi] - med), axis=0) * 1.4826 + 1e-6
        bad = np.abs(x[i] - med) > t * mad
        y[i][bad] = med[bad]
    return y

def lowpass(x, fps, cutoff):
    if len(x) < 16: return x
    b, a = butter(2, cutoff / (fps / 2))
    return filtfilt(b, a, x, axis=0, padlen=min(len(x) - 1, 12))

def forward_arm_prior(P):
    """Resolve the monocular depth-flip ambiguity of overhead arms.

    Mirroring an arm's elbow/wrist/hand depth about the shoulder's camera depth
    keeps the image projection. When the hand is overhead (shooting, layup
    reach), basketball anatomy puts it in front of the trunk, so the mirrored
    solution is used if it is clearly more forward. Decisions are median
    filtered over 7 frames so the arm cannot flicker between solutions.
    """
    from scipy.ndimage import median_filter
    n = len(P); out = P.copy(); report = {}
    for side, ids in (('right', (12, 14, [16, 18, 20, 22])), ('left', (11, 13, [15, 17, 19, 21]))):
        sh, el, hand = ids; chain = [el] + hand; flip = np.zeros(n)
        for i in range(n):
            up = unit((P[i, 11] + P[i, 12]) / 2 - (P[i, 23] + P[i, 24]) / 2)
            fwd = unit(np.cross(up, P[i, 12] - P[i, 11]))
            if P[i, hand[0], 1] < P[i, sh, 1] + .10: continue
            alt = P[i, chain].copy(); alt[:, 2] = 2 * P[i, sh, 2] - alt[:, 2]
            score = lambda pts: np.dot(pts[1] - P[i, sh], fwd) + .5 * np.dot(pts[0] - P[i, sh], fwd)
            flip[i] = score(alt) > score(P[i, chain]) + .05
        flip = median_filter(flip, 7, mode='nearest') > .5
        for i in np.where(flip)[0]: out[i, chain, 2] = 2 * P[i, sh, 2] - P[i, chain, 2]
        report[side] = [int(i) for i in np.where(flip)[0]]
    return out, report

def load(path, body_cutoff, hand_cutoff):
    data = json.load(open(path)); fps = data['fps']
    frames = data['frames']; n = len(frames)
    P = np.full((n, 33, 3), np.nan); V = np.zeros((n, 33))
    for i, f in enumerate(frames):
        if 'world' in f:
            w = np.array(f['world']); P[i] = np.stack([w[:, 0], -w[:, 1], -w[:, 2]], -1)  # MediaPipe -> Y-up
            V[i] = f['visibility']
    idx = np.arange(n)
    for j in range(33):
        for k in range(3):
            good = ~np.isnan(P[:, j, k]) & (V[:, j] > .15)
            if good.sum() < 2: good = ~np.isnan(P[:, j, k])
            P[:, j, k] = np.interp(idx, idx[good], P[good, j, k])
    P = hampel(P.reshape(n, -1)).reshape(n, 33, 3)
    P, flips = forward_arm_prior(P)
    if any(flips.values()): print('  depth-flip prior applied on frames', flips)
    hands = [L[k] for k in ('l_wr', 'r_wr', 'l_pinky', 'r_pinky', 'l_index', 'r_index', 'l_thumb', 'r_thumb')]
    out = lowpass(P.reshape(n, -1), fps, body_cutoff).reshape(n, 33, 3)
    out[:, hands] = lowpass(P[:, hands].reshape(n, -1), fps, hand_cutoff).reshape(n, len(hands), 3)
    return data, out, V

def level_and_unyaw(P, yaw_sigma=4):
    """Remove the moving camera's heading and level its pitch/roll."""
    from scipy.ndimage import gaussian_filter1d
    g = lambda a, b: (P[:, L[a]] + P[:, L[b]]) / 2
    hip, sh = g('l_hip', 'r_hip'), g('l_sh', 'r_sh')
    lateral = P[:, L['r_hip']] - P[:, L['l_hip']] + P[:, L['r_sh']] - P[:, L['l_sh']]
    up_body = unit(sh - hip)
    fwd = unit(np.cross(up_body, lateral))  # right x up = backward; up x right = forward
    # Camera pitch: the median trunk direction over the clip is treated as the
    # player's habitual lean, so only the camera's systematic tilt is removed.
    yaw = np.unwrap(np.arctan2(-fwd[:, 0], -fwd[:, 2]))
    yaw = gaussian_filter1d(yaw, yaw_sigma)
    out = np.empty_like(P)
    for i in range(len(P)):
        out[i] = R.from_euler('y', -yaw[i]).apply(P[i] - hip[i])
    # Level: rotate so the median ankle->shoulder axis seen from the side and
    # front is vertical, preserving per-frame lean relative to that median.
    ank = (out[:, L['l_ank']] + out[:, L['r_ank']]) / 2; shm = (out[:, L['l_sh']] + out[:, L['r_sh']]) / 2
    axis = unit(np.median(shm - ank, axis=0))
    tilt = R.align_vectors([UP], [axis])[0]
    return np.stack([tilt.apply(f) for f in out]), yaw

def hinge(upper, lower, flex_dir, prev=None):
    """Normal of the limb plane; falls back to a body-relative flex direction."""
    n = np.cross(upper, lower); s = np.linalg.norm(n)
    fallback = unit(np.cross(upper, flex_dir))
    w = np.clip((s - .10) / .25, 0, 1)
    return unit(n / max(s, 1e-9) * w + fallback * (1 - w))

# Hand orientation is not trusted from video: MediaPipe finger points are too
# small/noisy on court footage. Each hand instead follows a planned palm
# direction (right-hand coordinates; x is mirrored for the left hand) and a
# flex angle (+ curls fingers toward the palm side, - cocks the wrist back),
# built on the tracked forearm. Presets blend between plan keys.
HAND_PRESETS = {
    'relaxed': ([-1, -.2, .15], 15), 'guide': ([-1, .1, -.1], 5), 'set': ([-.15, .85, -.5], -45),
    'flick': ([0, -.55, -.85], 65), 'reach': ([-.2, .25, -.95], -15), 'soft-release': ([-.1, -.2, -.97], 35),
}
REST_PALM = {'right': (RIGHT, np.array([.06328680701153797, -.95874679214998, .27712699002516405])),
             'left': (-RIGHT, np.array([.18578951385363535, -.9821455594914199, -.029535682035727248]))}

def hand_plan_at(plan, side, i):
    keys = plan.get(side) or [[0, 'relaxed']]
    if i <= keys[0][0]: k0 = k1 = keys[0]; a = 0
    elif i >= keys[-1][0]: k0 = k1 = keys[-1]; a = 0
    else:
        j = next(j for j in range(1, len(keys)) if keys[j][0] >= i); k0, k1 = keys[j - 1], keys[j]
        a = (i - k0[0]) / max(1, k1[0] - k0[0]); a = a * a * (3 - 2 * a)
    (n0, f0), (n1, f1) = HAND_PRESETS[k0[1]], HAND_PRESETS[k1[1]]
    n = unit(np.array(n0, float)) * (1 - a) + unit(np.array(n1, float)) * a
    if side == 'left': n = n * np.array([-1, 1, 1])
    return unit(n), np.radians(f0 * (1 - a) + f1 * a)

def planned_hand(side, forearm_world, f, desired_normal, flex, prev_perp=None):
    n_perp = desired_normal - np.dot(desired_normal, f) * f
    if np.linalg.norm(n_perp) < .2 and prev_perp is not None: n_perp = prev_perp
    n_perp = unit(n_perp)
    fingers = f * np.cos(flex) + n_perp * np.sin(flex)
    normal = -f * np.sin(flex) + n_perp * np.cos(flex)
    rest_f, rest_n = REST_PALM[side]
    hand = R.from_matrix(frame(fingers, normal) @ frame(rest_f, rest_n).T)
    # Share up to 50 degrees of the needed pronation/supination with the forearm.
    m = forearm_world.apply(rest_n); m = unit(m - np.dot(m, f) * f)
    phi = np.arctan2(np.dot(np.cross(m, n_perp), f), np.dot(m, n_perp))
    forearm = R.from_rotvec(f * np.clip(phi * .5, -np.radians(50), np.radians(50))) * forearm_world
    return forearm, hand, n_perp

def clamp_relative(parent_world, child_world, max_deg):
    rel = parent_world.inv() * child_world; rv = rel.as_rotvec(); ang = np.linalg.norm(rv)
    if ang > np.radians(max_deg): rel = R.from_rotvec(rv / ang * np.radians(max_deg))
    return parent_world * rel

def solve(P, plan=None):
    plan = plan or {}; prev_perp = {}
    rest = rest_positions(); n = len(P)
    # Rest primary/secondary directions per bone (game space, asset local).
    d = lambda a, b: unit(rest[b] - rest[a])
    rest_frames = {
        'pelvis': frame(d('pelvis', 'chest'), RIGHT), 'chest': frame(d('chest', 'neck'), RIGHT),
        'neck': frame(UP, RIGHT), 'head': frame(UP, RIGHT),
        'right_upper_arm': frame(d('right_upper_arm', 'right_forearm'), np.cross(d('right_upper_arm', 'right_forearm'), FWD)),
        'right_forearm': frame(d('right_forearm', 'right_hand'), np.cross(d('right_forearm', 'right_hand'), FWD)),
        'left_upper_arm': frame(d('left_upper_arm', 'left_forearm'), np.cross(d('left_upper_arm', 'left_forearm'), FWD)),
        'left_forearm': frame(d('left_forearm', 'left_hand'), np.cross(d('left_forearm', 'left_hand'), FWD)),
        'right_hand': frame(RIGHT, FWD), 'left_hand': frame(-RIGHT, FWD),
        'right_thigh': frame(d('right_thigh', 'right_shin'), np.cross(d('right_thigh', 'right_shin'), -FWD)),
        'right_shin': frame(d('right_shin', 'right_foot'), np.cross(d('right_shin', 'right_foot'), -FWD)),
        'left_thigh': frame(d('left_thigh', 'left_shin'), np.cross(d('left_thigh', 'left_shin'), -FWD)),
        'left_shin': frame(d('left_shin', 'left_foot'), np.cross(d('left_shin', 'left_foot'), -FWD)),
        'right_foot': frame(unit(np.array([0, -.17, -.20])), RIGHT), 'left_foot': frame(unit(np.array([0, -.17, -.20])), RIGHT),
    }
    out = []
    p = lambda i, k: P[i, L[k]]
    for i in range(n):
        hipL = p(i, 'r_hip') - p(i, 'l_hip'); shL = p(i, 'r_sh') - p(i, 'l_sh')
        hipM = (p(i, 'l_hip') + p(i, 'r_hip')) / 2; shM = (p(i, 'l_sh') + p(i, 'r_sh')) / 2
        spine = shM - hipM
        W = {'root': R.identity()}
        # Both trunk bones share the hip->shoulder axis; the pelvis carries the
        # hip-line twist and the chest the shoulder-line twist.
        pel = R.from_matrix(frame(spine, hipL) @ rest_frames['pelvis'].T)
        che = R.from_matrix(frame(spine, shL) @ rest_frames['chest'].T)
        W['pelvis'], W['chest'] = pel, che
        body_fwd = che.apply(FWD)
        # Head from ears and nose, neck halfway between chest and head.
        earL = p(i, 'r_ear') - p(i, 'l_ear'); earM = (p(i, 'l_ear') + p(i, 'r_ear')) / 2
        face = p(i, 'nose') - earM
        head_up = unit(np.cross(earL, face))  # right x forward = up
        head = R.from_matrix(frame(head_up, earL) @ rest_frames['head'].T)
        # Monocular head tracking overstates pitch; keep 60% of the measured
        # head motion relative to the chest and split it across neck/head.
        head = clamp_relative(che, head, 55)
        head = Slerp([0, 1], R.concatenate([che, head]))(.6)
        W['neck'] = Slerp([0, 1], R.concatenate([che, head]))(.5); W['head'] = head
        for side, s in (('right', 'r'), ('left', 'l')):
            sh, el, wr = p(i, s + '_sh'), p(i, s + '_el'), p(i, s + '_wr')
            up_, lo_ = unit(el - sh), unit(wr - el)
            hn = hinge(up_, lo_, body_fwd)
            W[side + '_upper_arm'] = R.from_matrix(frame(up_, np.cross(hn, up_)) @ rest_frames[side + '_upper_arm'].T)
            W[side + '_forearm'] = R.from_matrix(frame(lo_, np.cross(hn, lo_)) @ rest_frames[side + '_forearm'].T)
            dn, flex = hand_plan_at(plan, side, i)
            W[side + '_forearm'], hand, prev_perp[side] = planned_hand(side, W[side + '_forearm'], lo_, dn, flex, prev_perp.get(side))
            W[side + '_hand'] = clamp_relative(W[side + '_forearm'], hand, 80)
            hp, kn, an = p(i, s + '_hip'), p(i, s + '_knee'), p(i, s + '_ank')
            th, sn = unit(kn - hp), unit(an - kn)
            ln = hinge(th, sn, -body_fwd)
            W[side + '_thigh'] = R.from_matrix(frame(th, np.cross(ln, th)) @ rest_frames[side + '_thigh'].T)
            W[side + '_shin'] = R.from_matrix(frame(sn, np.cross(ln, sn)) @ rest_frames[side + '_shin'].T)
            toe = p(i, s + '_toe'); heel = p(i, s + '_heel')
            foot_dir = unit(toe - an) * .6 + unit(toe - heel) * .4
            foot = R.from_matrix(frame(foot_dir, hipL) @ rest_frames[side + '_foot'].T)
            W[side + '_foot'] = clamp_relative(W[side + '_shin'], foot, 50)
        parent = {b['name']: b['parent'] for b in json.load(open(CONTRACT))['bones']}
        local = {}
        for b in BONES:
            pw = W.get(parent[b], R.identity()) if parent[b] in W else R.identity()
            local[b] = (pw.inv() * W[b]).as_quat()
        out.append(local)
    # Quaternion sign continuity.
    for b in BONES:
        for i in range(1, n):
            if np.dot(out[i][b], out[i - 1][b]) < 0: out[i][b] = -out[i][b]
    return out

def main():
    a = argparse.ArgumentParser(); a.add_argument('pose'); a.add_argument('out')
    a.add_argument('--body-cutoff', type=float, default=6.); a.add_argument('--hand-cutoff', type=float, default=4.)
    a.add_argument('--hand-plan', help='JSON {"right": [[frame, preset], ...], "left": [...]}')
    args = a.parse_args()
    data, P, V = load(args.pose, args.body_cutoff, args.hand_cutoff)
    P, yaw = level_and_unyaw(P)
    local = solve(P, json.loads(args.hand_plan) if args.hand_plan else None)
    # Diagnostics used to find timing events (takeoff/apex/landing/release).
    ank = np.minimum(P[:, L['l_ank'], 1], P[:, L['r_ank'], 1]); toe = np.minimum(P[:, L['l_toe'], 1], P[:, L['r_toe'], 1])
    json.dump({'source': data['source'], 'start': data['start'], 'fps': data['fps'], 'bones': BONES,
               'frames': [{b: [round(float(v), 6) for v in q[b]] for b in BONES} for q in local],
               'landmarks': np.round(P, 4).tolist(), 'sourceYaw': np.round(yaw, 4).tolist(),
               'lowestFootRelHip': np.round(np.minimum(ank, toe), 4).tolist()}, open(args.out, 'w'))
    print(f'{args.out}: {len(local)} frames')

if __name__ == '__main__': main()
