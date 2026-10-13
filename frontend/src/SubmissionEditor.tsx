import type { ChangeRequest } from './api'
import { StageSubmission } from './StageWorkflow'

type Props = {
  reviewDraftDirty?: boolean
  record: ChangeRequest; leaving: boolean; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void
  onPrevious: () => void; onBack: () => void; onReauthenticate: () => void
}

export default function SubmissionEditor(props: Props) {
  return <StageSubmission {...props} />
}
