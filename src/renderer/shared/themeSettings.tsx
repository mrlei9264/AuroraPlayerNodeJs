import React from 'react'
import type { AppSettingsData } from '../../main/system/settings-types'
import { Icon } from '../core/icons'

type ThemeStyle = AppSettingsData['themeStyle']

export function ThemeChoices({ value, language, onChange, disabled = false }: {
  value: ThemeStyle
  language: AppSettingsData['language']
  onChange: (value: ThemeStyle) => void
  disabled?: boolean
}) {
  const zh = language === 'zh'
  return (
    <div className="theme-choices" role="group" aria-label={zh ? '界面主题' : 'Interface theme'}>
      {(['classic', 'tahoe'] as const).map((style) => (
        <button
          type="button"
          key={style}
          className={`theme-choice ${value === style ? 'selected' : ''}`}
          aria-pressed={value === style}
          disabled={disabled}
          onClick={() => onChange(style)}
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')
              const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : style === 'classic' ? 1 : 0
              buttons?.[index]?.focus()
            }
          }}
        >
          <span className={`theme-choice-swatch ${style}`} aria-hidden="true"><Icon name={style === 'tahoe' ? 'paintbrush' : 'home'} size={24} /></span>
          <span className="theme-choice-copy">
            <strong>{style === 'classic' ? (zh ? '深色主题' : 'Dark theme') : (zh ? '浅色主题' : 'Light theme')}</strong>
            <small>{style === 'classic' ? (zh ? '深蓝灰 · 通透玻璃' : 'Slate blue · Glass') : (zh ? '冷白蓝 · 通透玻璃' : 'Cool white · Glass')}</small>
          </span>
          <span className="theme-choice-check" aria-hidden="true">{value === style && <Icon name="check" size={14} />}</span>
        </button>
      ))}
    </div>
  )
}
