import { Input, type InputProps } from 'antd'
import { useState, type SyntheticEvent } from 'react'

// Native date inputs allow five or more year digits even with a max attribute.
export default function DateInput({ value, onChange, ...props }: InputProps) {
  const [incomplete, setIncomplete] = useState(false)
  const change = (event: SyntheticEvent<HTMLInputElement>) => {
    // Ant Design clones change targets, losing the native date's partial-input validity.
    const nativeTarget = event.nativeEvent.target
    const target = nativeTarget instanceof HTMLInputElement ? nativeTarget : event.target as HTMLInputElement
    const date = target.value
    if (!target.validity.badInput && date && (date.split('-')[0].length > 4 || Number(date.split('-')[0]) < 1)) {
      target.value = String(value ?? '')
    }
    setIncomplete(target.validity.badInput)
    onChange?.(Object.create(event, { target: { value: target }, currentTarget: { value: target } }))
  }
  const checkValidity = (event: SyntheticEvent<HTMLInputElement>) => {
    if (event.currentTarget.validity.badInput || incomplete) change(event)
  }
  return <><Input allowClear {...props} type="date" min="0001-01-01" max="9999-12-31" value={incomplete ? '' : value} onChange={change} onInput={(event) => {
    checkValidity(event)
    props.onInput?.(event)
  }} onKeyUp={(event) => {
    // Some native date segments emit no input/change event until the ISO value changes.
    checkValidity(event)
    props.onKeyUp?.(event)
  }} onBlur={(event) => {
    checkValidity(event)
    props.onBlur?.(event)
  }} />{incomplete && <p className="question-hint" role="alert">日期尚未填写完整，请补全日期或清空全部日期部分后保存。</p>}</>
}
