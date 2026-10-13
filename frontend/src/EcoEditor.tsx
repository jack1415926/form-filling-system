import type { ChangeRequest } from './api'
import { StageActions } from './StageWorkflow'

export default function EcoEditor({ record, onDirty, onBusy, onBack, onPrevious, onNext, leaving, onReauthenticate, onEditorOpen }: {
  record: ChangeRequest; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void
  onBack: () => void; onPrevious: () => void; onNext: () => void; leaving: boolean; onReauthenticate: () => void; onEditorOpen: (value: boolean) => void
}) {
  return <StageActions record={record} onDirty={onDirty} onBusy={onBusy} onBack={onBack} onPrevious={onPrevious} onNext={onNext} leaving={leaving} onReauthenticate={onReauthenticate} onEditorOpen={onEditorOpen} />
}
