"""Validate the canonical Luke retarget target; clip authoring is Part 2.

    python scripts/retarget-dribble.py

The historical fictional-player/CMU exporter is recoverable from Git history.
It is intentionally unavailable here: matching bone names did not establish
rest-pose compatibility. This script never imports or publishes an old rig.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def main():
    if len(sys.argv) != 1:
        raise RuntimeError('Part 1 validates Luke target only; clip export is pending Part 2')
    config = json.loads((REPO / 'scripts/luke-retarget-config.json').read_text())
    contract = json.loads((REPO / config['rigContract']).read_text())
    data = (REPO / config['targetAsset']).read_bytes()
    if hashlib.sha256(data).hexdigest() != config['targetSha256']:
        raise RuntimeError('Luke target hash differs; deliberate contract revision required')
    document = json.loads(data[20:20 + struct.unpack_from('<I', data, 12)[0]])
    skin = document['skins'][0]
    parent = {child: i for i, node in enumerate(document['nodes']) for child in node.get('children', [])}
    if len(skin['joints']) != len(contract['bones']):
        raise RuntimeError('Luke joint count differs')
    for index, expected in zip(skin['joints'], contract['bones']):
        node = document['nodes'][index]
        if node['name'] != expected['name'] or document['nodes'][parent[index]]['name'] != expected['parent']:
            raise RuntimeError('Luke hierarchy differs')
        for key, default in [('translation', [0, 0, 0]), ('rotation', [0, 0, 0, 1]), ('scale', [1, 1, 1])]:
            if node.get(key, default) != expected[key]:
                raise RuntimeError('Luke rest transform differs: ' + node['name'])
    accessor = document['accessors'][skin['inverseBindMatrices']]
    if accessor['type'] != 'MAT4' or accessor['componentType'] != 5126 or accessor['count'] != 17:
        raise RuntimeError('Luke inverse-bind accessor differs')
    view = document['bufferViews'][accessor['bufferView']]
    binary_offset = 28 + struct.unpack_from('<I', data, 12)[0]
    offset = binary_offset + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', 64)
    for i, expected in enumerate(contract['bones']):
        actual = struct.unpack_from('<16f', data, offset + i * stride)
        if any(abs(a - b) > 1e-6 for a, b in zip(actual, expected['inverseBindMatrix'])):
            raise RuntimeError('Luke inverse bind matrix differs: ' + expected['name'])
    print(json.dumps({'target': config['targetAsset'], 'status': config['status'],
                      'bones': len(skin['joints']), 'inverseBindMatrices': 'validated', 'clipsExported': 0,
                      'nextStage': 'Part 2: author and validate Luke-compatible clips'}, indent=2))


if __name__ == '__main__':
    main()
