import { expect } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)

Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'en-US' })
