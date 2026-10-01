import { createContext, useContext, useEffect, useState } from 'react'
import { en } from './locales/en'
import { ru } from './locales/ru'

export const LOCALE_KEY = 'ganttai.locale'
const catalogs = { en, ru }
const localeTags = { en: 'en-US', ru: 'ru-RU' }

export function detectLocale(language = globalThis.navigator?.language) {
  const primary = typeof language === 'string' ? language.toLowerCase().split('-')[0] : ''
  return primary === 'en' ? 'en' : 'ru'
}

export function errorDescriptor(error, fallbackKey) {
  if (error?.translationKey) return { key: error.translationKey, values: error.translationValues }
  if (error?.serverProvided && typeof error.serverMessage === 'string') return { message: error.serverMessage }
  return { key: fallbackKey }
}

function initialLocale() {
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    if (saved === 'en' || saved === 'ru') return saved
  } catch { /* Use browser detection when storage is unavailable. */ }
  return detectLocale()
}

const defaultValue = {
  locale: 'en', localeTag: localeTags.en, setLocale: () => {},
  t: (key, values = {}) => typeof en[key] === 'function' ? en[key](values) : en[key] ?? key,
  formatDate: (value, options) => new Intl.DateTimeFormat(localeTags.en, { ...options, timeZone: 'UTC' }).format(new Date(value)),
}

const I18nContext = createContext(defaultValue)

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(initialLocale)
  const setLocale = (next) => {
    if (next !== 'en' && next !== 'ru') return
    setLocaleState(next)
    try { localStorage.setItem(LOCALE_KEY, next) } catch { /* Keep the in-memory choice. */ }
  }
  const t = (key, values = {}) => {
    const message = catalogs[locale][key] ?? en[key]
    return typeof message === 'function' ? message(values) : message ?? key
  }
  const formatDate = (value, options) => new Intl.DateTimeFormat(localeTags[locale], { ...options, timeZone: 'UTC' }).format(new Date(value))

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = t('documentTitle')
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('documentDescription'))
  }, [locale])

  return <I18nContext.Provider value={{ locale, localeTag: localeTags[locale], setLocale, t, formatDate }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}
