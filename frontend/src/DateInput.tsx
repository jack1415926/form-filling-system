import { Button, Input, type InputProps, type InputRef } from 'antd'
import { useRef, useState, type ChangeEvent } from 'react'
import { dateError, minDate, maxDate } from './dateValidation'

export default function DateInput({ value, onChange, ...props }: InputProps) {
  const input = useRef<InputRef>(null), picker = useRef<HTMLInputElement>(null)
  // 不完整日期只保留在控件内，不能把它误当作清空操作写回已保存日期。
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? String(value ?? '')
  const error = dateError(text)
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value, error = dateError(text)
    const target = input.current!.input!
    target.value = text
    target.setCustomValidity(error ?? '')
    setDraft(error ? text : null)
    // 转发真实输入框的有效性状态，同时兼容Ant Design清空按钮产生的事件。
    onChange?.(Object.create(event, { target: { value: target }, currentTarget: { value: target } }))
  }
  return <>
    <Input allowClear {...props} ref={input} type="text" placeholder="YYYY-MM-DD" value={text}
      aria-invalid={!!error} status={error ? 'error' : props.status} onChange={change}
      suffix={<Button type="text" size="small" disabled={props.disabled} aria-label="选择日期" onClick={() => picker.current?.showPicker()}>日历</Button>} />
    <input ref={picker} type="date" aria-hidden="true" tabIndex={-1} disabled={props.disabled}
      min={minDate} max={maxDate} value={error ? '' : text} onChange={change}
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
    {error && <p className="question-hint" role="alert">{error}</p>}
  </>
}
