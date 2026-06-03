import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { computeWidth } from '../clampWidth'

/**
 * Property 1: Width calculation tracks pointer with offset
 *
 * For any pointer X position and any initial drag offset,
 * computeWidth(pointerX, offset, min, max) SHALL produce a value
 * equal to clamp(pointerX - offset, min, max).
 *
 * Validates: Requirements 3.1
 */
describe('Feature: resizable-sidebar, Property 1: Width calculation tracks pointer with offset', () => {
  /** Generate min/max pair where min <= max */
  const arbMinMax = fc
    .tuple(fc.double({ min: 0, max: 5000, noNaN: true }), fc.double({ min: 0, max: 5000, noNaN: true }))
    .map(([a, b]) => (a <= b ? { min: a, max: b } : { min: b, max: a }))

  it('computeWidth equals clamp(pointerX - offset, min, max) for arbitrary inputs', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        arbMinMax,
        (pointerX, offset, { min, max }) => {
          const result = computeWidth(pointerX, offset, min, max)
          const expected = Math.min(max, Math.max(min, pointerX - offset))

          expect(result).toBe(expected)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('computeWidth result is always within [min, max]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        arbMinMax,
        (pointerX, offset, { min, max }) => {
          const result = computeWidth(pointerX, offset, min, max)

          expect(result).toBeGreaterThanOrEqual(min)
          expect(result).toBeLessThanOrEqual(max)
        }
      ),
      { numRuns: 200 }
    )
  })
})
