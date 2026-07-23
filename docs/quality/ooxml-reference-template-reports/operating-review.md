# `operating-review@1` fidelity report

- source SHA-256: `ec2084d143a4d52857cc06c24129abbb45c45d04b90cca06e319ac26d3cadd4f`
- source slides: 31
- catalog/rollout: disabled
- actual-source identity clone (31 slides): `passed`
- identity clone package validation/reopen: `passed` (warning 0)
- identity clone LibreOffice render: `passed`
- identity clone SHA-256: `e08124beeb04211a61c1319f2e38d1fb8c86d4b262ef8d579cfe455716af7d6a`
- PowerPoint identity-control diff (31 slides): `passed` (changed pixel 0)
- PowerPoint identity-control report SHA-256: `8ba7e1e726238ff077fa22676e8223a1239143499cc11aefd7dfbf5717e0b429`
- identity render SHA-256: `1393e20e1fbd511936514c1f1f5a676499c0b10f4501fb0f3bb3659680299903`
- actual full-deck generation (8 slides): `passed`
- generated package SHA-256: `29fb2e5eff04d761343ffc2e5e470c462ad57367769c942d26ffffd1530e5931`
- generated full-deck OOXML ZIP/package validation: `passed` (warning 0)
- generated document properties: `sanitized` (`Slides=8`, stale/private metadata 0)
- Microsoft PowerPoint render/reopen: `passed` (8 slides, PowerPoint 16.111)
- PowerPoint full-deck human visual review: `approved` (2026-07-23)
- PowerPoint render PDF SHA-256: `4ea3b8a29db64f8e0103ebc2703767f0148e3df3aeef02b3148f87c2695112a3`
- PowerPoint full-deck montage/report SHA-256: `c29ba2c270ef45c0378f8d058a8d579be10e0a5e53c0fa1e6f4cded0af9d82b5` / `f24f1adefdc43a9b6fae3dfc975a78c3837277171b919e9c0ae54443e35895fe`
- generated full-deck LibreOffice render/reopen: `passed` (8 slides, LibreOffice 26.8.0.0)
- generated render SHA-256: `ed61abfc169f7e79c44f8155b6b1b13e6fcfb18d21e246c9d7b3ee2020b7e79b`
- generated montage SHA-256: `27f444a076ac429c7fdb60b318e68bb55ea94968ada27e19c926456fc4a7c045`
- slot edit → sync/export/reopen: `passed` (warning 0, unsupported 0, text retained)
- edited package SHA-256: `5d1cf8204bc84edbb07afeabcd2f93e5acf535a16760b90e45e1d6711864c144`
- edited PowerPoint PDF SHA-256: `1ed1ac6785a96a2bc247ff476a5c2e907995584b15e77741cbad904e0d24d3a8`
- edited-slot montage: `approved` (locked diff 42px accepted as mask-boundary antialiasing)
- edited-slot montage/report SHA-256: `57f334fbc0b6369ff72e4bf8478b501fdc0ab5038599415a4160c6797e0cb1c2` / `9ad9e2e9350b2badabfeb601aa4f7a4e80ad713e7dc2534745666c7ee0814a11`
- product materialization warning: `0`
- fidelity artifact: `generated/pending` (structural drift 0, locked diff 85px)
- source/locked-diff montage SHA-256: `5a8fd7fa0cddae08066e3ffbabb9c32212eef056a556fad614dc46d95a2e75ca` / `bfa0939cc4d6fbee4600f17ef76be98bba00ce110140be4f6f34138a50788371`
- fidelity report SHA-256: `08e282f5942d93a56d2e190d5058b6cf94329ba4fea540b789b509752596b2fc`

Blocker: production managed storage, exact font checksum과 calibration/actual editor UX 승인이
남았다. 기존 drift fixture 대신 quality SHA-256과 일치한 deterministic reproduction을
PowerPoint에서 검증했다.
