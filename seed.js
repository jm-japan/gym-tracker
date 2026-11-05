// seed.js — the starting program loaded the first time the app opens.
// Program structure:
//   Program -> days[] -> exercises[] -> sets[]
// A set:  { type: 'warmup'|'working'|'backoff',
//           load: { mode: 'kg'|'pct', value },   // value empty = choose weight on the day
//           reps, repsMax (for ranges like 8–10), amrap, rir }

function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
}

function seedProgram() {
  const s = (type, kg, reps, repsMax = null, o = {}) =>
    ({ type, load: { mode: 'kg', value: kg }, reps, repsMax, amrap: false, rir: null, ...o });
  const rep = (n, ...a) => Array.from({ length: n }, () => s(...a));
  const ex = (name, o, sets) => ({
    id: newId(), name, notes: '', maxKey: '', inc: 1.25, superset: '', perSide: false, optional: false, ...o, sets
  });

  return {
    id: newId(),
    name: '3-Day Lower / Upper / Lower',
    days: [
      {
        id: newId(), name: 'Day 1: Lower (Squat & Heavy Glute)',
        target: 'Quads, heavy glute max, calf/abs support',
        exercises: [
          ex('Barbell Back Squat', { maxKey: 'Squat', inc: 5 }, [
            s('warmup', 60, 5), s('warmup', 80, 3), s('warmup', 90, 2),
            s('working', 100, 5), s('working', 110, 3), s('working', 120, 3, 5, { rir: 1 }),
            ...rep(2, 'backoff', 95, 6, 8)
          ]),
          ex('Barbell Hip Thrust / Kas Glute Bridge', { notes: 'Pause 2 s at peak contraction on every rep' },
            rep(3, 'working', null, 8, 10)),
          ex('Bulgarian Split Squat (glute-biased)', { perSide: true, notes: 'Torso ~45° forward, vertical front shin' },
            rep(3, 'working', null, 8, 10)),
          ex('Leg Extension', { notes: 'Take the last set to mechanical failure' },
            [...rep(2, 'working', null, 12, 15), s('working', null, 12, 15, { amrap: true })]),
          ex('Leg Abduction Machine', { notes: 'Slow 2 s eccentric' },
            rep(3, 'working', null, 12, 15)),
        ]
      },
      {
        id: newId(), name: 'Day 2: Upper (Push & Pull)',
        target: 'Chest, back width/thickness, shoulders, arms',
        exercises: [
          ex('Barbell Bench Press', { maxKey: 'Bench', inc: 2.5 }, [
            s('warmup', 40, 5), s('warmup', 50, 3),
            s('working', 60, 8), s('working', 70, 6), s('working', 75, 5, 6, { rir: 1 }),
            ...rep(2, 'backoff', 62.5, 8, 10)
          ]),
          ex('Bent-Over Row / Chest-Supported T-Bar Row', { notes: 'Chest-supported option protects the lower back' },
            rep(3, 'working', null, 8, 10)),
          ex('Overhead Press', { maxKey: 'OHP', inc: 1.25, notes: '2–3 working sets — 3rd set optional' }, [
            s('warmup', 25, 5), s('warmup', 30, 3),
            s('working', 35, 6), s('working', 40, 4, 6, { rir: 1 }), s('working', 40, 4, 6, { rir: 1 })
          ]),
          ex('Lat Pulldown / Neutral-Grip Pull-Up', { notes: 'Vertical pull for upper back balance' },
            rep(3, 'working', null, 8, 12)),
          ex('Incline DB Press / Pec Deck', {}, rep(3, 'working', null, 10, 12)),
          ex('Cable Side Lateral Raise', { superset: 'A', notes: 'Drop set on the final set' },
            rep(3, 'working', null, 10, 12)),
          ex('Flat Bar Cable Bicep Curl', { superset: 'A' }, rep(3, 'working', null, 10, 12)),
          ex('Flat Bar Cable Tricep Pushdown', { superset: 'A' }, rep(3, 'working', null, 10, 15)),
        ]
      },
      {
        id: newId(), name: 'Day 3: Lower (Deadlift/RDL & Glutes)',
        target: 'Posterior chain, hamstrings, glute med/max, upper back',
        exercises: [
          ex('Conventional Deadlift', { maxKey: 'Deadlift', inc: 5, optional: true,
            notes: 'Choose Deadlift OR RDL today — skip the other' }, [
            s('working', 140, 5), s('working', 160, 3), s('working', 180, 2, 3, { rir: 1 }),
            ...rep(2, 'backoff', 135, 6)
          ]),
          ex('Romanian Deadlift (RDL)', { optional: true, inc: 2.5,
            notes: 'Preferred for pure hypertrophy — deep hamstring/glute stretch' },
            rep(3, 'working', null, 8, 10)),
          ex('Hip Thrust Machine / Cable Pull-Through', { notes: 'Moderate weight, high tension' },
            rep(3, 'working', null, 10, 12)),
          ex('Lying / Seated Hamstring Curl', {}, rep(3, 'working', null, 10, 12)),
          ex('Glute Med Cable Kickback / Reverse Hyper', { perSide: true }, rep(3, 'working', null, 12, 15)),
          ex('Face Pull / Rear Delt Fly', { notes: 'Shoulder health and upper-back posture' },
            rep(3, 'working', null, 12, 15)),
        ]
      }
    ]
  };
}

function seedMaxes() {
  return { Squat: { kg: null }, Bench: { kg: null }, OHP: { kg: null }, Deadlift: { kg: null } };
}
