# GTA VI Twitch CCU Forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/fahroz1/gta6-twitch-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/fahroz1/gta6-twitch-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecasts, hour by hour, how many people watch Grand Theft Auto VI live on
Twitch over the 24 UTC hours of its release day, 2026-11-19, from everything
recorded up to the end of its first hour, that hour's count included, as five
quantiles an hour (5%, 25%, 50%, 75%, 95%).

Entry for the [make.fun bounty "Forecast GTA VI's launch-day Twitch viewers hour by hour"](https://make.fun/bounty/gta6-twitch-ccu-forecast-01).

## Method: shape from the past

The case file carries the hourly Twitch curves of dozens of past big game
launches ("comparables"), each from 14 days before its release day to 3 days
after it. For every comparable I build its release-day ratio curve: each
hour's viewers divided by that launch's own hour-1 viewers. A launch's
hour-1 count anchors its scale; the ratios say how the audience moves
through the day.

For the target launch, I take the 12 comparables whose hour-1 count is
closest in log space to the target's hour-1 count (nearest neighbours by
launch scale), and for each hour 2..24 I read the five empirical quantiles
of those neighbours' ratios and multiply by the target's hour-1 count.

Why nearest neighbours by hour-1 scale, not all comparables at once: the
launches split in two. A launch whose hour-1 was already large (its unlock
had happened by then, as for GTA VI at UK midnight) has a flat ratio curve
near 1, peaking around 1.0-2.7x. A launch whose hour-1 was nearly empty (its
unlock came later in the UTC day) has ratios that explode to 100-2000x.
Pooling both groups wrecks the forecast: the median ratio is dragged up and
the 95% quantile lands hundreds of times too high. Matching on hour-1 scale
keeps the forecast on launches shaped like the target.

## Practice result

Evaluated on the four practice launches (Marvel's Wolverine, Red Dead
Redemption 2, God of War Ragnarök, Marvel's Spider-Man 2) against SullyGnome's
hourly averages, the forecaster scores a mean pinball loss of **0.241**,
against **0.387** for the house persistence baseline — beating it on all
four cases.

## Run it

Node 22, standard library only. No network, no dependencies.

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `<id>.in` in the input directory and writes one `<id>.out` per
case: `{"hours":[{"hour":2,"q":[q05,q25,q50,q75,q95]}, ...]}`, exactly 23
rows, hours 2..24, each q a finite number above 0 and at most 1e9,
non-decreasing. Deterministic: two runs on the same case write the same
bytes. Runs in well under a second per case (limit 8s).

## Files

- `main.ts` — the forecaster (the entrypoint the grader runs)
- `LICENSE` — MIT
