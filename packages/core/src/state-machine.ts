import { invalidState } from "./errors";

/**
 * Declarative transition table. `transitions[from]` lists allowed targets.
 */
export interface StateMachine<S extends string> {
  name: string;
  states: readonly S[];
  transitions: Readonly<Record<S, readonly S[]>>;
  terminal: readonly S[];
}

export function defineMachine<S extends string>(m: StateMachine<S>): StateMachine<S> & {
  can(from: S, to: S): boolean;
  assert(from: S, to: S): void;
  next(from: S): readonly S[];
} {
  for (const s of m.states) {
    if (!(s in m.transitions)) throw new Error(`${m.name}: missing transitions for ${s}`);
    for (const t of m.transitions[s]) {
      if (!m.states.includes(t)) throw new Error(`${m.name}: unknown target ${t}`);
    }
  }
  return {
    ...m,
    can: (from, to) => m.transitions[from]?.includes(to) ?? false,
    assert(from, to) {
      if (!m.transitions[from]?.includes(to)) {
        throw invalidState(`${m.name}: transition ${from} → ${to} not allowed`, { from, to, machine: m.name });
      }
    },
    next: (from) => m.transitions[from] ?? [],
  };
}
