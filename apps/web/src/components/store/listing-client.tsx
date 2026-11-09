"use client";

import * as React from "react";

/** A select that submits its GET form on change; the form keeps a submit button for keyboard / no-JS use. */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
