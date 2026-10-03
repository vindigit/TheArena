"""Clean a reference clip and extract 3D body landmarks for Luke retargeting.

Pass 1 locates the player on every frame of the requested segment. Pass 2
re-runs MediaPipe Pose (heavy) in VIDEO mode on a smoothed, square crop that
follows the player, which is what makes small, far-away players trackable.
Outputs (under --out):
  <name>.clean.mp4   cropped/stabilised/denoised 30 fps clip with no audio
  <name>.overlay.mp4 the same clip with the detected skeleton drawn on top
  <name>.pose.json   per-frame image + world landmarks and visibility

usage: python3 extract_pose.py VIDEO --start S --end E --name NAME --out DIR
       [--fps 30] [--model pose_landmarker_heavy.task] [--mask x,y,w,h ...]
"""
import argparse, json, os, subprocess, sys
import cv2, numpy as np
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
from scipy.ndimage import gaussian_filter1d

EDGES = [(11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,24),(23,25),(25,27),(27,29),(29,31),(27,31),
         (24,26),(26,28),(28,30),(30,32),(28,32),(0,11),(0,12)]

def read_segment(path, start, end, fps):
    tmp = path + f'.{start}-{end}-{fps}.raw.mp4'
    cmd = ['ffmpeg','-v','error','-y','-ss',str(start),'-to',str(end),'-i',path,'-an',
           '-vf',f'fps={fps},hqdn3d=1.5:1.5:4:4','-c:v','libx264','-crf','12','-preset','fast',tmp]
    subprocess.run(cmd, check=True)
    cap = cv2.VideoCapture(tmp); frames = []
    while True:
        ok, f = cap.read()
        if not ok: break
        frames.append(f)
    os.remove(tmp)
    return frames

def landmarker(model, mode, confidence=.4):
    return vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model), running_mode=mode, num_poses=1,
        min_pose_detection_confidence=confidence, min_pose_presence_confidence=confidence,
        min_tracking_confidence=confidence, output_segmentation_masks=False))

def apply_masks(img, masks):
    for (x,y,w,h) in masks:
        roi = img[y:y+h, x:x+w]
        img[y:y+h, x:x+w] = cv2.inpaint(roi, np.full(roi.shape[:2],255,np.uint8), 3, cv2.INPAINT_TELEA)
    return img

def main():
    a = argparse.ArgumentParser()
    a.add_argument('video'); a.add_argument('--start', type=float, required=True); a.add_argument('--end', type=float, required=True)
    a.add_argument('--name', required=True); a.add_argument('--out', required=True); a.add_argument('--fps', type=int, default=30)
    a.add_argument('--model', default='/opt/tools/models/pose_landmarker_heavy.task')
    a.add_argument('--mask', action='append', default=[], help='x,y,w,h burned-in text box to inpaint (source pixels)')
    a.add_argument('--crop', type=int, default=768); a.add_argument('--margin', type=float, default=1.45)
    args = a.parse_args(); os.makedirs(args.out, exist_ok=True)
    masks = [tuple(int(v) for v in m.split(',')) for m in args.mask]
    frames = [apply_masks(f, masks) for f in read_segment(args.video, args.start, args.end, args.fps)]
    H, W = frames[0].shape[:2]
    # Pass 1: coarse location on the full frame (upscaled 2x for small players).
    boxes = []
    with landmarker(args.model, vision.RunningMode.VIDEO, .3) as det:
        for i, f in enumerate(frames):
            big = cv2.resize(f, (W*2, H*2), interpolation=cv2.INTER_CUBIC) if H < 1200 else f
            r = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(big, cv2.COLOR_BGR2RGB)), int(i*1000/args.fps))
            if r.pose_landmarks:
                p = np.array([[l.x*W, l.y*H] for l in r.pose_landmarks[0]])
                boxes.append([*p.min(0), *p.max(0)])
            else: boxes.append(None)
    known = [i for i,b in enumerate(boxes) if b is not None]
    if len(known) < len(frames)*.5: sys.exit(f'player found on only {len(known)}/{len(frames)} frames')
    b = np.array([boxes[i] if boxes[i] is not None else [np.nan]*4 for i in range(len(frames))])
    for k in range(4):
        col = b[:,k]; idx = np.arange(len(col)); good = ~np.isnan(col)
        b[:,k] = np.interp(idx, idx[good], col[good])
    cx = gaussian_filter1d((b[:,0]+b[:,2])/2, 3); cy = gaussian_filter1d((b[:,1]+b[:,3])/2, 3)
    # A fixed crop size per clip keeps the player's scale constant, which
    # stabilises MediaPipe's depth estimate.
    size = int(min(min(W,H), np.percentile(np.maximum(b[:,2]-b[:,0], b[:,3]-b[:,1]), 90)*args.margin))
    crops = []
    for i, f in enumerate(frames):
        x0 = int(np.clip(cx[i]-size/2, 0, W-size)); y0 = int(np.clip(cy[i]-size/2, 0, H-size))
        crops.append((x0, y0, cv2.resize(f[y0:y0+size, x0:x0+size], (args.crop, args.crop), interpolation=cv2.INTER_LANCZOS4)))
    # Gentle local contrast so jerseys/limbs separate from the court.
    clahe = cv2.createCLAHE(2.0, (8,8))
    def enhance(img):
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB); lab[:,:,0] = clahe.apply(lab[:,:,0]); return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    out_frames = []
    clean = cv2.VideoWriter(os.path.join(args.out, args.name+'.clean.tmp.mp4'), cv2.VideoWriter_fourcc(*'mp4v'), args.fps, (args.crop,)*2)
    over = cv2.VideoWriter(os.path.join(args.out, args.name+'.overlay.tmp.mp4'), cv2.VideoWriter_fourcc(*'mp4v'), args.fps, (args.crop,)*2)
    with landmarker(args.model, vision.RunningMode.VIDEO, .4) as det:
        for i,(x0,y0,img) in enumerate(crops):
            img = enhance(img); clean.write(img)
            r = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)), int(i*1000/args.fps))
            vis = img.copy(); rec = {'frame': i, 'time': i/args.fps, 'crop': [x0,y0,size]}
            if r.pose_landmarks:
                lm, wl = r.pose_landmarks[0], r.pose_world_landmarks[0]
                rec['image'] = [[l.x, l.y, l.z] for l in lm]
                rec['world'] = [[l.x, l.y, l.z] for l in wl]
                rec['visibility'] = [float(l.visibility) for l in lm]
                pts = [(int(l.x*args.crop), int(l.y*args.crop)) for l in lm]
                for e in EDGES: cv2.line(vis, pts[e[0]], pts[e[1]], (0,255,255), 2, cv2.LINE_AA)
                for j,p in enumerate(pts[11:], 11): cv2.circle(vis, p, 4, (0,0,255) if j%2 else (255,128,0), -1, cv2.LINE_AA)
            cv2.putText(vis, f'{args.name} f{i:03d} t={args.start+i/args.fps:.2f}s', (10,24), cv2.FONT_HERSHEY_SIMPLEX, .6, (255,255,255), 2)
            over.write(vis); out_frames.append(rec)
    clean.release(); over.release()
    for kind in ('clean','overlay'):
        tmp = os.path.join(args.out, f'{args.name}.{kind}.tmp.mp4')
        subprocess.run(['ffmpeg','-v','error','-y','-i',tmp,'-c:v','libx264','-pix_fmt','yuv420p','-crf','18',
                        os.path.join(args.out, f'{args.name}.{kind}.mp4')], check=True); os.remove(tmp)
    found = sum('world' in f for f in out_frames)
    json.dump({'source': os.path.basename(args.video), 'start': args.start, 'end': args.end, 'fps': args.fps,
               'cropSize': size, 'frames': out_frames}, open(os.path.join(args.out, args.name+'.pose.json'),'w'))
    print(f'{args.name}: {found}/{len(out_frames)} frames with pose, crop {size}px')

if __name__ == '__main__': main()
