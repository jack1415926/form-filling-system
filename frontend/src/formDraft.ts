import type { MaterialValues, Overview } from './api.ts'

const overviewFields: (keyof Overview)[] = ['title', 'ecr_no', 'eco_no', 'affected_products', 'affected_region', 'initiating_factory', 'affected_factories', 'ccb_owner', 'change_owner', 'planned_eco_date', 'change_reason']

export function overviewPatch(baseline: Overview, values: Partial<Overview>, unconfirmed: Partial<Overview> = {}): Partial<Overview> {
  const patch: Partial<Overview> = {}
  for (const key of overviewFields) {
    if (!(key in values)) continue
    const value = key === 'planned_eco_date' ? values[key] || null : values[key] ?? ''
    if (value !== baseline[key] || key in unconfirmed) Object.assign(patch, { [key]: value })
  }
  return patch
}

export type MaterialField = Exclude<keyof MaterialValues, 'dispositions'>

export function materialPatch(baseline: Partial<MaterialValues> | undefined, values: Partial<MaterialValues>, fields: MaterialField[], unconfirmed: Partial<MaterialValues> = {}): Partial<MaterialValues> {
  const patch: Partial<MaterialValues> = {}
  for (const key of fields) {
    const value = values[key] ?? ''
    if (!baseline || value !== (baseline[key] ?? '') || key in unconfirmed) Object.assign(patch, { [key]: value })
  }
  const dispositions: MaterialValues['dispositions'] = {}
  const locations = new Set([...Object.keys(baseline?.dispositions ?? {}), ...Object.keys(values.dispositions ?? {}), ...Object.keys(unconfirmed.dispositions ?? {})])
  for (const location of locations) {
    const changed: MaterialValues['dispositions'][string] = {}
    for (const key of ['disposition', 'remark'] as const) {
      const value = values.dispositions?.[location]?.[key] ?? ''
      if (value !== (baseline?.dispositions?.[location]?.[key] ?? '') || key in (unconfirmed.dispositions?.[location] ?? {})) changed[key] = value
    }
    if (Object.keys(changed).length) dispositions[location] = changed
  }
  if (Object.keys(dispositions).length) patch.dispositions = dispositions
  return patch
}
