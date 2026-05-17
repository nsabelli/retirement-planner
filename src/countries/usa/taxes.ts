import type { TaxBracket } from '../../types';
import {
  TAX_BRACKETS_MFJ,
  TAX_BRACKETS_SINGLE,
  STANDARD_DEDUCTION_MFJ,
  STANDARD_DEDUCTION_SINGLE,
  CAPITAL_GAINS_BRACKETS_MFJ,
  CAPITAL_GAINS_BRACKETS_SINGLE,
} from './constants';

/**
 * Scale a bracket table by an inflation factor. Brackets are 2026 IRS values;
 * the IRS indexes thresholds to inflation, so projecting them forward keeps the
 * model consistent with inflated (nominal) income in future years.
 */
function scaleBrackets(brackets: TaxBracket[], bracketInflation: number): TaxBracket[] {
  if (bracketInflation === 1) return brackets;
  return brackets.map(b => ({
    min: b.min * bracketInflation,
    max: b.max === Infinity ? Infinity : b.max * bracketInflation,
    rate: b.rate,
  }));
}

export function getTaxBrackets(filingStatus?: string, bracketInflation = 1): TaxBracket[] {
  const base = filingStatus === 'married_filing_jointly'
    ? TAX_BRACKETS_MFJ
    : TAX_BRACKETS_SINGLE;
  return scaleBrackets(base, bracketInflation);
}

export function getStandardDeduction(filingStatus?: string, bracketInflation = 1): number {
  const base = filingStatus === 'married_filing_jointly'
    ? STANDARD_DEDUCTION_MFJ
    : STANDARD_DEDUCTION_SINGLE;
  return base * bracketInflation;
}

export function getCapitalGainsBrackets(filingStatus?: string, bracketInflation = 1): TaxBracket[] {
  const base = filingStatus === 'married_filing_jointly'
    ? CAPITAL_GAINS_BRACKETS_MFJ
    : CAPITAL_GAINS_BRACKETS_SINGLE;
  return scaleBrackets(base, bracketInflation);
}

/**
 * Calculate federal income tax on ordinary income
 */
export function calculateFederalIncomeTax(
  taxableIncome: number,
  filingStatus?: string,
  bracketInflation = 1
): number {
  if (taxableIncome <= 0) return 0;

  const brackets = getTaxBrackets(filingStatus, bracketInflation);
  let tax = 0;
  let remainingIncome = taxableIncome;

  for (const bracket of brackets) {
    const bracketWidth = bracket.max - bracket.min;
    const incomeInBracket = Math.min(remainingIncome, bracketWidth);

    if (incomeInBracket <= 0) break;

    tax += incomeInBracket * bracket.rate;
    remainingIncome -= incomeInBracket;
  }

  return tax;
}

/**
 * Calculate capital gains tax
 */
export function calculateCapitalGainsTax(
  capitalGains: number,
  otherTaxableIncome: number,
  filingStatus?: string,
  bracketInflation = 1
): number {
  if (capitalGains <= 0) return 0;

  const brackets = getCapitalGainsBrackets(filingStatus, bracketInflation);
  const standardDeduction = getStandardDeduction(filingStatus, bracketInflation);

  const incomeBase = Math.max(0, otherTaxableIncome - standardDeduction);

  let tax = 0;
  let remainingGains = capitalGains;
  let currentIncome = incomeBase;

  for (const bracket of brackets) {
    if (remainingGains <= 0) break;

    const roomInBracket = Math.max(0, bracket.max - currentIncome);
    const gainsInBracket = Math.min(remainingGains, roomInBracket);

    if (gainsInBracket > 0 && currentIncome + gainsInBracket > bracket.min) {
      const effectiveGains = Math.min(
        gainsInBracket,
        currentIncome + gainsInBracket - Math.max(bracket.min, currentIncome)
      );
      tax += effectiveGains * bracket.rate;
    }

    currentIncome += gainsInBracket;
    remainingGains -= gainsInBracket;
  }

  return tax;
}

/**
 * Calculate total federal tax
 */
export function calculateTotalFederalTax(
  ordinaryIncome: number,
  capitalGains: number,
  filingStatus?: string,
  bracketInflation = 1
): number {
  const standardDeduction = getStandardDeduction(filingStatus, bracketInflation);
  const taxableOrdinaryIncome = Math.max(0, ordinaryIncome - standardDeduction);

  const incomeTax = calculateFederalIncomeTax(taxableOrdinaryIncome, filingStatus, bracketInflation);
  const capitalGainsTax = calculateCapitalGainsTax(capitalGains, ordinaryIncome, filingStatus, bracketInflation);

  return incomeTax + capitalGainsTax;
}

/**
 * Return the marginal ordinary-income tax bracket (inflation-projected) that the
 * given gross ordinary income falls into, for display in year-by-year data.
 * `min`/`max` are the inflated (nominal) bracket boundaries for that year.
 */
export function getMarginalBracket(
  ordinaryIncome: number,
  filingStatus?: string,
  bracketInflation = 1
): TaxBracket {
  const brackets = getTaxBrackets(filingStatus, bracketInflation);
  const standardDeduction = getStandardDeduction(filingStatus, bracketInflation);
  const taxable = Math.max(0, ordinaryIncome - standardDeduction);
  for (const bracket of brackets) {
    if (taxable < bracket.max) return bracket;
  }
  return brackets[brackets.length - 1];
}
