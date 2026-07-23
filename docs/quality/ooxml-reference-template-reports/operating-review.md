# `operating-review@1` fidelity report

- source SHA-256: `ec2084d143a4d52857cc06c24129abbb45c45d04b90cca06e319ac26d3cadd4f`
- source slides: 31
- catalog/rollout: disabled
- actual-source identity clone (31 slides): `passed`
- identity clone package validation/reopen: `passed` (warning 0)
- identity clone LibreOffice render: `passed`
- identity clone SHA-256: `e08124beeb04211a61c1319f2e38d1fb8c86d4b262ef8d579cfe455716af7d6a`
- identity render SHA-256: `1393e20e1fbd511936514c1f1f5a676499c0b10f4501fb0f3bb3659680299903`
- actual full-deck generation (8 slides): `passed`
- generated package SHA-256: `096a6dfc2efc072ebf11d6788a2f2c3349d7812918b98825d24b5e16cadfb859`
- generated full-deck OOXML ZIP/package validation: `passed` (warning 0)
- Microsoft PowerPoint render/reopen: `passed` (8 slides, PowerPoint 16.111)
- PowerPoint render PDF SHA-256: `469d48784400d70e563ebf7de8bd6b80be9146409687dcf21e0e839ee2f41fc9`
- generated full-deck LibreOffice render/reopen: `passed` (8 slides, LibreOffice 26.8.0.0)
- generated render SHA-256: `ed61abfc169f7e79c44f8155b6b1b13e6fcfb18d21e246c9d7b3ee2020b7e79b`
- generated montage SHA-256: `27f444a076ac429c7fdb60b318e68bb55ea94968ada27e19c926456fc4a7c045`
- slot edit → sync/export/reopen: `passed` (warning 0, unsupported 0, text retained)
- edited package SHA-256: `e264c8278c9b18d9f555d22a1d3048a55cce2724ffc8970fc190d26acb7317a4`
- edited PowerPoint PDF SHA-256: `5335429a9f3ff449b7e801870368e98869f96e917e19a8ef200085d63d1147cb`
- product materialization warning: `0`
- fidelity artifact: `generated/pending` (structural drift 0, locked diff 85px)
- source/locked-diff montage SHA-256: `5a8fd7fa0cddae08066e3ffbabb9c32212eef056a556fad614dc46d95a2e75ca` / `bfa0939cc4d6fbee4600f17ef76be98bba00ce110140be4f6f34138a50788371`
- fidelity report SHA-256: `539089864fcc50bccd6bf5e70153864f2984ae47c1cf1c0b06f1ee5bc2546a06`

Blocker: production managed storage, exact font checksum과 사람 locked-diff/calibration/UX
승인이 남았다. 기존 drift fixture 대신 quality SHA-256과 일치한 deterministic reproduction을
PowerPoint에서 검증했다.
