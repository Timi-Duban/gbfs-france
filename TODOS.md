# TODOS

1. Free-floating bikes via `vehicle_status` / `free_bike_status` (Lime, Pony, Dott are excluded today).
2. Coordinate-only nearby lookup for the Expo app ("near me" without a network id), from snapshot station bounding boxes.
3. Web proxy (Vercel Hobby): forward only snapshot feed URLs (allowlist), serve normalized CDN-cached output (`s-maxage`), check the Hobby non-commercial terms.
4. Outdated flag noise (medium, found by /qa 2026-11-02): JCDecaux networks (Nantes, Toulouse, Nancy, Amiens, Besançon) and Vélo'v report `last_reported` hours old while their feeds are fresh, so every station shows "last report over 30 min ago". Decide a rule, e.g. ignore `last_reported` when most stations of a fresh feed share the lag. Repro: `nearby_stations` on Naolib Nantes.
5. `search_networks` text has no source line, although the README says every answer credits its data (low, /qa 2026-11-02). Add "Source: transport.data.gouv.fr, snapshot <date>".
6. Substring search is loose (low, /qa 2026-11-02): "velov" also returns ViVélo Vichy and Rubis'Vélo, ranked after Vélo'v.
