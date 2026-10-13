import { useEffect, useId, useState } from 'react'

interface Option {
  id: string
  label: string
}

interface Props {
  options: Option[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  placeholder?: string
}

// a plain input + <datalist>, good enough until I want a fancier combobox
export function SearchSelect({ options, selectedId, onSelect, placeholder }: Props) {
  const listId = useId()
  const selectedLabel = options.find((option) => option.id === selectedId)?.label ?? ''
  const [text, setText] = useState(selectedLabel)

  // keep the text in sync when the selection changes from outside (e.g. weapon swap clears mods)
  useEffect(() => setText(selectedLabel), [selectedLabel])

  const handleChange = (value: string) => {
    setText(value)
    if (value === '') return onSelect(null)
    const match = options.find((option) => option.label === value)
    if (match) onSelect(match.id)
  }

  return (
    <>
      <input
        list={listId}
        value={text}
        placeholder={placeholder}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={() => setText(selectedLabel)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.id} value={option.label} />
        ))}
      </datalist>
    </>
  )
}
