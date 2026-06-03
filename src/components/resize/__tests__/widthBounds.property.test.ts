import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { clampWidth } from '../clampWidth'
import { MIN_WIDTH, MAX_WIDTH_RATIO } from '../constants'

/**
 * Property 2: Width bounds invariant
 *
 * For any raw value, clampWidth result is always within [min, max].
 * This holds regardless of whether the resize originates from pointer drag,
 * arrow key, or shift+arrow key.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 7.3, 7.4
 */
describe('Feature: resizable-sidebar, Property 2: Width bounds invariant', () => {
  it('clampWidth result is always >= min and <= max for arbitrary inputs', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.double({ noNaN: true, noDefaultInfinity: true, min: 1 }),
        fc.double({ noNaN: true, noDefaultInfinity: true, min: 1 }),
        (raw, minCandidate, maxCandidate) => {
          // Ensure min <= max for a valid constraint pair
          const min = Math.min(minCandidate, maxCandidate)
          const max = Math.max(minCandidate, maxCandidate)

          const result = clampWidth(raw, min, max)

          expect(result).toBeGreaterThanOrEqual(min)
          expect(result).toBeLessThanOrEqual(max)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('clampWidth result respects actual MIN_WIDTH and computed max from MAX_WIDTH_RATIO', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.double({ noNaN: true, noDefaultInfinity: true, min: MIN_WIDTH * 2 }),
        (raw, bodyWidth) => {
          const max = Math.floor(bodyWidth * MAX_WIDTH_RATIO)
          // Only meaningful when max >= MIN_WIDTH
          fc.pre(max >= MIN_WIDTH)

          const result = clampWidth(raw, MIN_WIDTH, max)

          expect(result).toBeGreaterThanOrEqual(MIN_WIDTH)
          expect(result).toBeLessThanOrEqual(max)
        }
      ),
      { numRuns: 200 }
    )
  })
})
