import { FilingStatus, TaxBracket } from '../types';
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

export function getTaxBrackets(filingStatus: FilingStatus, bracketInflation = 1): TaxBracket[] {
  const base = filingStatus === 'married_filing_jointly'
    ? TAX_BRACKETS_MFJ
    : TAX_BRACKETS_SINGLE;
  return scaleBrackets(base, bracketInflation);
}

export function getStandardDeduction(filingStatus: FilingStatus, bracketInflation = 1): number {
  const base = filingStatus === 'married_filing_jointly'
    ? STANDARD_DEDUCTION_MFJ
    : STANDARD_DEDUCTION_SINGLE;
  return base * bracketInflation;
}

export function getCapitalGainsBrackets(filingStatus: FilingStatus, bracketInflation = 1): TaxBracket[] {
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
  filingStatus: FilingStatus,
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
 * Calculate capital gains tax on taxable brokerage withdrawals
 * Simplified: treats the entire gain portion at long-term capital gains rates
 */
export function calculateCapitalGainsTax(
  capitalGains: number,
  otherTaxableIncome: number,
  filingStatus: FilingStatus,
  bracketInflation = 1
): number {
  if (capitalGains <= 0) return 0;

  const brackets = getCapitalGainsBrackets(filingStatus, bracketInflation);
  const standardDeduction = getStandardDeduction(filingStatus, bracketInflation);

  // Capital gains stack on top of ordinary income for bracket determination
  const incomeBase = Math.max(0, otherTaxableIncome - standardDeduction);

  let tax = 0;
  let remainingGains = capitalGains;
  let currentIncome = incomeBase;

  for (const bracket of brackets) {
    if (remainingGains <= 0) break;

    // How much room is left in this bracket?
    const roomInBracket = Math.max(0, bracket.max - currentIncome);
    const gainsInBracket = Math.min(remainingGains, roomInBracket);

    if (gainsInBracket > 0 && currentIncome + gainsInBracket > bracket.min) {
      // Some gains fall in this bracket
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
 * Calculate total federal tax on a mix of income types
 */
export function calculateTotalFederalTax(
  ordinaryIncome: number, // Traditional withdrawals, SS, etc.
  capitalGains: number, // Growth portion of taxable account withdrawals
  filingStatus: FilingStatus,
  bracketInflation = 1
): number {
  const standardDeduction = getStandardDeduction(filingStatus, bracketInflation);
  const taxableOrdinaryIncome = Math.max(0, ordinaryIncome - standardDeduction);

  const incomeTax = calculateFederalIncomeTax(taxableOrdinaryIncome, filingStatus, bracketInflation);
  const capitalGainsTax = calculateCapitalGainsTax(capitalGains, ordinaryIncome, filingStatus, bracketInflation);

  return incomeTax + capitalGainsTax;
}

/**
 * Calculate state tax (simplified flat rate)
 */
export function calculateStateTax(
  taxableIncome: number,
  stateTaxRate: number
): number {
  return Math.max(0, taxableIncome) * stateTaxRate;
}

/**
 * Calculate the marginal tax rate for the next dollar of ordinary income
 */
export function getMarginalTaxRate(
  currentTaxableIncome: number,
  filingStatus: FilingStatus,
  bracketInflation = 1
): number {
  const standardDeduction = getStandardDeduction(filingStatus, bracketInflation);
  const adjustedIncome = currentTaxableIncome - standardDeduction;

  if (adjustedIncome <= 0) return 0;

  const brackets = getTaxBrackets(filingStatus, bracketInflation);

  for (const bracket of brackets) {
    if (adjustedIncome <= bracket.max) {
      return bracket.rate;
    }
  }

  return brackets[brackets.length - 1].rate;
}

/**
 * Marginal ordinary-income bracket (inflation-projected) for the given gross
 * ordinary income. Fallback equivalent of the US country config's
 * getMarginalBracket, used when no country config is supplied.
 */
export function getMarginalBracket(
  ordinaryIncome: number,
  filingStatus: FilingStatus,
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

/**
 * Calculate how much can be withdrawn from traditional accounts
 * while staying in a specific tax bracket
 */
export function getWithdrawalToFillBracket(
  currentOrdinaryIncome: number,
  targetBracketRate: number,
  filingStatus: FilingStatus
): number {
  const standardDeduction = getStandardDeduction(filingStatus);
  const brackets = getTaxBrackets(filingStatus);

  // Find the target bracket
  const targetBracket = brackets.find(b => b.rate === targetBracketRate);
  if (!targetBracket) return 0;

  const currentTaxable = Math.max(0, currentOrdinaryIncome - standardDeduction);

  // If already past this bracket, return 0
  if (currentTaxable >= targetBracket.max) return 0;

  // If below this bracket, include room from lower brackets
  const startPoint = Math.max(currentTaxable, targetBracket.min);
  const roomInBracket = targetBracket.max - startPoint;

  // If we're below the standard deduction, add that room too
  const deductionRoom = currentOrdinaryIncome < standardDeduction
    ? standardDeduction - currentOrdinaryIncome
    : 0;

  return roomInBracket + deductionRoom;
}

/**
 * Calculate how much can be converted from traditional to Roth
 * to fill all brackets UP TO AND INCLUDING the target bracket.
 * Used for Roth conversion planning before RMD age.
 */
export function getConversionToTopOfBracket(
  currentOrdinaryIncome: number,
  targetBracketRate: number,
  filingStatus: FilingStatus,
  bracketInflation = 1
): number {
  const standardDeduction = getStandardDeduction(filingStatus, bracketInflation);
  const brackets = getTaxBrackets(filingStatus, bracketInflation);

  const targetBracket = brackets.find(b => b.rate === targetBracketRate);
  if (!targetBracket) return 0;

  const currentTaxable = Math.max(0, currentOrdinaryIncome - standardDeduction);

  if (currentTaxable >= targetBracket.max) return 0;

  const deductionRoom = currentOrdinaryIncome < standardDeduction
    ? standardDeduction - currentOrdinaryIncome
    : 0;

  // Room from current taxable income all the way to top of target bracket
  const taxableRoom = targetBracket.max - currentTaxable;
  return taxableRoom + deductionRoom;
}

/**
 * Effective tax rate
 */
export function getEffectiveTaxRate(
  totalTax: number,
  grossIncome: number
): number {
  if (grossIncome <= 0) return 0;
  return totalTax / grossIncome;
}
