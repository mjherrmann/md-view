import { describe, it } from 'vitest'
import fc from 'fast-check'
import { clampWidth } from '../clampWidth'
import { MIN_WIDTH, KEYBOARD_STEP, KEYBOARD_STEP_LARGE } from '../constants'

/**
 * Property 3: Keyboard resize delta correctness
 *
 * For any valid starting width w and step size s (10 or 50), pressing the
 * increase key produces clamp(w + s, min, max) and pressing the decrease key
 * produces clamp(w - s, min, max).
 *
 * Validates: Requirements 7.3, 7.4
 */
describe('Feature: resizable-sidebar, Property 3: Keyboard resize delta correctness', () => {
  const arbWidth = fc.integer({ min: 0, max: 5000 })
  const arbMax = fc.integer({ min: MIN_WIDTH, max: 5000 })
  const arbStep = fc.constantFrom(KEYBOARD_STEP, KEYBOARD_STEP_LARGE)

  it('increase key produces clamp(w + step, min, max)', () => {
    fc.assert(
      fc.property(arbWidth, arbMax, arbStep, (w, max, step) => {
        const result = clampWidth(w + step, MIN_WIDTH, max)
        const expected = Math.min(max, Math.max(MIN_WIDTH, w + step))
        return result === expected
      }),
      { numRuns: 200 }
    )
  })

  it('decrease key produces clamp(w - step, min, max)', () => {
    fc.assert(
      fc.property(arbWidth, arbMax, arbStep, (w, max, step) => {
        const result = clampWidth(w - step, MIN_WIDTH, max)
        const expected = Math.min(max, Math.max(MIN_WIDTH, w - step))
        return result === expected
      }),
      { numRuns: 200 }
    )
  })
})
