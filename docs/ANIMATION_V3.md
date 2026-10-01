# Luke game animation v3

The accepted retargeted running, forward-dribble and basketball-shot base is integrated into Luke's canonical 17-bone rig. The canonical GLB, rest frames, skin, texture and neutral mesh remain unchanged. Four runtime-only hand morphs provide independent cupped/spread hands with neutral relaxation; no finger bones were added.

Source restrictions are in [animation credits](../public/assets/animation-credits.txt). Motion data is included for this playable game, not licensed as a reusable standalone animation asset. Do not redistribute paid source files, editable motion libraries, private authoring archives or vendor character art.

Gameplay owns translation, ball physics and possession. Shot key/pointer release commits the hop; physical ball detach is 0.20 s later at apex. Meter charge time is additional input latency. Root lift is 0.3048 m, and the measured lowest actual shoe surface at apex is 0.3048001 m. Landing is 0.40 s after commit. Cosmetic recovery ends at 0.70 s; deliberate movement is available on landing without waiting for a make or miss. Source-stage torso yaw is removed so the body follows gameplay hoop-facing rather than unwinding after landing. The off hand relaxes after release, while the shooting flick holds until 0.50 s before settling.

The run is retargeted from ManNeko running; basketball motion uses CMU06_02 and124_05. Both are cleaned and constrained in the gameplay adapter. Pickup, layup and dunk retain the prior Luke-authored body poses. World-space shoe plants use posed shoe surfaces, and stationary shots return to takeoff anchors. Hand safety evaluates the actual displayed triangles and ball sphere. The legacy flat-palm point remains a separately reported diagnostic; it is not the deformed hand surface.

Validation includes canonical rig checks, full project regression tests, exactly-once early/held/automatic release, variable frame rates, reset interruptions, keyboard/touch handler paths, actual sole clearance, landing anchors, and hand triangle checks. The separate PC browser checks and public deployment verification must be recorded against the final commit. A numerical check is not visual acceptance.
