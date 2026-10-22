from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path


ASSET_ROOT = 'https://fco.dn.nexoncdn.co.kr/live/externalAssets/common'


@lru_cache(maxsize=1)
def labels() -> dict:
    return json.loads((Path(__file__).parent / 'data/squad_feed_labels.json').read_text())


def feature(code: int | None, label: str, category: str) -> dict:
    known = code is not None and str(code) in labels()[category]
    path = f'trainingTrait/training_trait_icon_{code:03d}.png' if category == 'training' and known else f'traits/trait_icon_{code:02d}.png' if known else None
    return {'code': code, 'label': label, 'known': known, 'icon_url': f'{ASSET_ROOT}/{path}' if path else None}


@lru_cache(maxsize=1)
def intrinsic_codes() -> dict[str, int]:
    return {''.join(name.split()): int(code) for code, name in labels()['traits'].items()}


def intrinsic_features(names: list[str]) -> list[dict]:
    codes = intrinsic_codes()
    return [feature(codes.get(''.join(name.split())), name, 'traits') for name in names]
