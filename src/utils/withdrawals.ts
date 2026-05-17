import {
  Account,
  Profile,
  Assumptions,
  AccumulationResult,
  RetirementResult,
  YearlyWithdrawal,
  FilingStatus,
  getTaxTreatment,
  isTraditional,
  WithdrawalStrategySettings,
  AccountTypeGroup,
} from '../types';
import type { IncomeStream } from '../types';
import {
  calculateTotalFederalTax,
  calculateStateTax,
  getStandardDeduction,
  getConversionToTopOfBracket,
  getMarginalBracket,
} from './taxes';
import { getRMDDivisor, RMD_START_AGE } from './constants';
import type { CountryConfig } from '../countries';
import { calculatePenalties, type AccountWithdrawal } from './penaltyCalculator';
import { getDefaultWithdrawalAge } from './withdrawalDefaults';
import { calculateIncomeStreamBenefits } from './incomeStreams';

// The federal tax brackets / standard deduction in constants are 2026 IRS
// values; this is the base year from which they are inflation-projected.
const TAX_BASE_YEAR = 2026;

interface AccountState {
  id: string;
  type: Account['type'];
  balance: number;
  costBasis: number; // For taxable accounts, tracks original investment
}

/**
 * Calculate Required Minimum Distribution for traditional accounts
 * Uses country-specific logic if CountryConfig provided
 */
function calculateRMD(
  age: number,
  traditionalBalance: number,
  accountType: string,
  countryConfig?: CountryConfig
): number {
  if (countryConfig) {
    return countryConfig.getMinimumWithdrawal(age, traditionalBalance, accountType);
  }
  // Fallback to US RMD logic
  if (age < RMD_START_AGE) return 0;
  const divisor = getRMDDivisor(age);
  if (divisor <= 0) return 0;
  return traditionalBalance / divisor;
}

/**
 * Check if we're before the mandatory minimum withdrawal age (RMD / RRIF start).
 * Uses the country config's minimum withdrawal logic with a dummy balance.
 */
function isPreRMDAge(age: number, accountType: string, countryConfig?: CountryConfig): boolean {
  return calculateRMD(age, 100000, accountType, countryConfig) === 0;
}

/**
 * Filter accounts by withdrawal availability based on age
 */
function getAvailableAccounts(
  accountStates: AccountState[],
  accounts: Account[],
  currentAge: number,
  retirementAge: number,
  countryConfig?: CountryConfig
): AccountState[] {
  return accountStates.filter(state => {
    // Find the full account object to get withdrawal rules
    const account = accounts.find(a => a.id === state.id);
    if (!account) return true; // If we can't find it, allow withdrawal

    // Get withdrawal start age (from rules or default)
    const withdrawalAge = account.withdrawalRules?.startAge ??
      (countryConfig
        ? getDefaultWithdrawalAge(account, retirementAge, countryConfig)
        : retirementAge);

    return currentAge >= withdrawalAge;
  });
}

/**
 * Compute federal + state income tax for a year's income (penalties excluded).
 * Extracted so the after-tax gross-up solver and the committed run share logic.
 */
function computeIncomeTaxes(
  ordinaryIncome: number,
  capitalGains: number,
  profile: Profile,
  countryConfig?: CountryConfig,
  bracketInflation = 1
): { federalTax: number; stateTax: number } {
  let federalTax: number;
  let stateTax: number;

  if (countryConfig) {
    federalTax = countryConfig.calculateFederalTax(ordinaryIncome, profile.filingStatus, bracketInflation);
    federalTax += countryConfig.calculateCapitalGainsTax(
      capitalGains,
      ordinaryIncome,
      profile.region || '',
      profile.filingStatus,
      bracketInflation
    );
    stateTax = countryConfig.calculateRegionalTax(
      ordinaryIncome + capitalGains,
      profile.region || ''
    );
    if (countryConfig.code === 'US') {
      stateTax = calculateStateTax(
        ordinaryIncome + capitalGains - getStandardDeduction(profile.filingStatus || 'single', bracketInflation),
        profile.stateTaxRate || 0
      );
    }
  } else {
    federalTax = calculateTotalFederalTax(
      ordinaryIncome,
      capitalGains,
      profile.filingStatus || 'single',
      bracketInflation
    );
    stateTax = calculateStateTax(
      ordinaryIncome + capitalGains - getStandardDeduction(profile.filingStatus || 'single', bracketInflation),
      profile.stateTaxRate || 0
    );
  }

  return { federalTax, stateTax };
}

/**
 * Solve the gross spend target whose after-tax spendable cash equals
 * `afterTaxTarget`. Iterative because a larger withdrawal raises taxes, which
 * raises the need. Runs trial withdrawals on a clone so it never mutates state.
 * Used both for the committed run and to size the Roth-conversion spending need.
 */
function solveAfterTaxSpendTarget(
  snapshot: AccountState[],
  accounts: Account[],
  afterTaxTarget: number,
  rmdAmount: number,
  totalRetirementIncome: number,
  profile: Profile,
  age: number,
  countryConfig: CountryConfig | undefined,
  fixedOrdinaryIncome: number,
  governmentBenefitIncome: number,
  inflatedStreamIncome: number,
  bracketCommittedOrdinaryIncome: number,
  bracketInflation: number,
  strategy?: WithdrawalStrategySettings
): number {
  let solved = afterTaxTarget;
  let prevGross = -1;
  for (let iter = 0; iter < 20; iter++) {
    const trialStates = snapshot.map(s => ({ ...s }));
    const trial = performTaxOptimizedWithdrawal(
      trialStates,
      accounts,
      solved,
      rmdAmount,
      totalRetirementIncome,
      profile,
      {},
      age,
      countryConfig,
      bracketCommittedOrdinaryIncome,
      strategy,
      bracketInflation
    );
    const trialPenalties = countryConfig
      ? calculatePenalties(trial.accountWithdrawals, age, countryConfig)
      : [];
    const trialPenaltyTotal = trialPenalties.reduce((sum, p) => sum + p.amount, 0);
    const { federalTax: tFed, stateTax: tState } = computeIncomeTaxes(
      trial.traditionalWithdrawal + fixedOrdinaryIncome,
      trial.taxableGains,
      profile,
      countryConfig,
      bracketInflation
    );
    const trialAfterTax = trial.total + governmentBenefitIncome +
      inflatedStreamIncome - (tFed + tState + trialPenaltyTotal);
    const shortfall = afterTaxTarget - trialAfterTax;
    if (Math.abs(shortfall) < 1) break;
    // Portfolio exhausted — withdrawing more is impossible, stop grossing up.
    if (trial.total <= prevGross + 0.01) break;
    prevGross = trial.total;
    solved += shortfall;
  }
  return solved;
}

/**
 * Simulate retirement withdrawals with tax-optimized strategy
 */
export function calculateWithdrawals(
  accounts: Account[],
  profile: Profile,
  assumptions: Assumptions,
  accumulationResult: AccumulationResult,
  countryConfig?: CountryConfig,
  incomeStreams?: IncomeStream[],
  withdrawalStrategy?: WithdrawalStrategySettings
): RetirementResult {
  const retirementYears = profile.lifeExpectancy - profile.retirementAge;
  const currentYear = new Date().getFullYear();
  const retirementStartYear = currentYear + (profile.retirementAge - profile.currentAge);

  // Initialize account states with final balances from accumulation
  const accountStates: AccountState[] = accounts.map(account => ({
    id: account.id,
    type: account.type,
    balance: accumulationResult.finalBalances[account.id] || 0,
    // For taxable accounts, estimate cost basis as original balance + contributions
    // (simplified: assume 50% of balance is gains)
    costBasis: getTaxTreatment(account.type) === 'taxable'
      ? (accumulationResult.finalBalances[account.id] || 0) * 0.5
      : 0,
  }));

  const totalPortfolio = accumulationResult.totalAtRetirement;
  const mode = assumptions.withdrawalMode ?? 'swr';
  // In target_spending mode the user enters today's dollars. Inflate to the
  // nominal value at the start of retirement so year-by-year inflation growth
  // continues correctly from there.
  const yearsToRetirement = Math.max(0, profile.retirementAge - profile.currentAge);
  const initialTargetSpending = mode === 'target_spending' && assumptions.targetMonthlySpending
    ? assumptions.targetMonthlySpending * 12 * Math.pow(1 + assumptions.inflationRate, yearsToRetirement)
    : totalPortfolio * assumptions.safeWithdrawalRate;
  let targetSpending = initialTargetSpending;
  const effectiveWithdrawalRate = totalPortfolio > 0 ? initialTargetSpending / totalPortfolio : 0;

  const yearlyWithdrawals: YearlyWithdrawal[] = [];
  let lifetimeTaxesPaid = 0;
  let portfolioDepletionAge: number | null = null;
  const accountDepletionAges: Record<string, number | null> = {};

  accounts.forEach(account => {
    accountDepletionAges[account.id] = null;
  });

  for (let i = 0; i <= retirementYears; i++) {
    const age = profile.retirementAge + i;
    const year = retirementStartYear + i;

    // Check if portfolio is depleted
    const totalRemaining = accountStates.reduce((sum, acc) => sum + acc.balance, 0);
    if (totalRemaining <= 0 && portfolioDepletionAge === null) {
      portfolioDepletionAge = age;
    }

    // Common inflation factor for this year
    const yearsFromNow = age - profile.currentAge;
    const inflationMultiplier = Math.pow(1 + assumptions.inflationRate, yearsFromNow);

    // Tax brackets / standard deduction are 2026 IRS values. The IRS indexes
    // these to inflation, so project them forward from the 2026 base tax year
    // to keep them consistent with inflated (nominal) income in future years.
    const bracketInflation = Math.pow(
      1 + assumptions.inflationRate,
      Math.max(0, year - TAX_BASE_YEAR)
    );

    // Effective filing status for this year. Supports a simulated future change
    // (e.g. widow/widower penalty: MFJ → Single at a specified age).
    const effectiveFilingStatus: FilingStatus =
      profile.filingStatusChangeAge !== undefined &&
      profile.filingStatusAfterChange !== undefined &&
      age >= profile.filingStatusChangeAge
        ? profile.filingStatusAfterChange
        : (profile.filingStatus || 'single');

    // Year-specific profile so every helper downstream sees the right filing status.
    const yearProfile: Profile =
      effectiveFilingStatus !== (profile.filingStatus || 'single')
        ? { ...profile, filingStatus: effectiveFilingStatus }
        : profile;

    // Calculate government retirement benefits (Social Security, CPP/OAS, etc.)
    let governmentBenefits = 0;
    if (countryConfig) {
      const benefits = countryConfig.calculateRetirementBenefits(profile, age, 0);
      governmentBenefits = benefits.reduce((sum, b) => sum + b.annualAmount, 0);
      // Adjust for inflation
      governmentBenefits *= inflationMultiplier;
    } else {
      // Fallback to US Social Security
      if (
        profile.socialSecurityBenefit &&
        profile.socialSecurityStartAge &&
        age >= profile.socialSecurityStartAge
      ) {
        governmentBenefits = profile.socialSecurityBenefit * inflationMultiplier;
      }
    }
    const governmentBenefitIncome = governmentBenefits;

    // Calculate user-defined income stream benefits
    const streamResult = calculateIncomeStreamBenefits(incomeStreams || [], age);
    // Apply inflation adjustment (stream amounts are in today's dollars)
    const inflatedStreamIncome = streamResult.totalIncome * inflationMultiplier;
    const inflatedStreamByTax = {
      social_security: streamResult.byTaxTreatment.social_security * inflationMultiplier,
      fully_taxable: streamResult.byTaxTreatment.fully_taxable * inflationMultiplier,
      other_income: streamResult.byTaxTreatment.other_income * inflationMultiplier,
      tax_free: streamResult.byTaxTreatment.tax_free * inflationMultiplier,
    };

    const totalRetirementIncome = governmentBenefitIncome + inflatedStreamIncome;

    // Calculate minimum required withdrawals (RMD/RRIF) for each traditional account
    // NOTE: Per IRS rules, RMDs are calculated per-account, not on total balance.
    // Each account's RMD is based on that account's prior year-end balance.
    // This is also correct for Canadian RRIF minimums.
    // Use country config for traditional detection if available
    const isTraditionalAccount = (type: string) =>
      countryConfig ? countryConfig.isTraditionalAccount(type) : isTraditional(type);
    let totalMinimumWithdrawal = 0;
    accountStates
      .filter(acc => isTraditionalAccount(acc.type))
      .forEach(acc => {
        const minWithdrawal = calculateRMD(age, acc.balance, acc.type, countryConfig);
        totalMinimumWithdrawal += minWithdrawal;
      });
    const rmdAmount = totalMinimumWithdrawal;

    // Pre-compute non-portfolio taxable income for bracket-filling logic
    const nonPortfolioTaxableIncome =
      governmentBenefitIncome * 0.85 +
      inflatedStreamByTax.social_security * 0.85 +
      inflatedStreamByTax.fully_taxable +
      inflatedStreamByTax.other_income;

    // Roth conversions (pre-RMD years only)
    const conversionSettings = withdrawalStrategy?.rothConversion;
    let rothConversionAmount = 0;
    const conversionByAccount: Record<string, number> = {};

    if (conversionSettings?.enabled) {
      const traditionalStates = accountStates.filter(
        acc => isTraditionalAccount(acc.type) && acc.balance > 0
      );
      const rothState = accountStates.find(
        acc => getTaxTreatment(acc.type) === 'roth'
      );

      if (traditionalStates.length > 0 && rothState) {
        const firstTraditionalType = traditionalStates[0].type;
        const preRMD = isPreRMDAge(age, firstTraditionalType, countryConfig);

        if (preRMD) {
          const filingStatus = effectiveFilingStatus;
          const preConvSnapshot = accountStates.map(s => ({ ...s }));
          const rothId = rothState.id;
          const totalTraditionalBalance = traditionalStates.reduce(
            (sum, acc) => sum + acc.balance,
            0
          );
          const conversionCap = conversionSettings.maxAnnualConversion > 0
            ? conversionSettings.maxAnnualConversion
            : Infinity;

          // For a candidate conversion, simulate it on a clone and return the
          // traditional spending withdrawal the committed run would make. The
          // conversion is taxable, so in target_spending mode the gross-up
          // pulls extra traditional withdrawals to pay that tax — which is
          // exactly the ordinary income that must be left room for.
          const spendingTradForConversion = (desiredC: number): number => {
            const clone = preConvSnapshot.map(s => ({ ...s }));
            let remainingC = Math.max(0, desiredC);
            let actualC = 0;
            for (const acc of clone) {
              if (remainingC <= 0) break;
              if (!isTraditionalAccount(acc.type) || acc.balance <= 0) continue;
              const conv = Math.min(remainingC, acc.balance);
              acc.balance -= conv;
              remainingC -= conv;
              actualC += conv;
            }
            const rothClone = clone.find(a => a.id === rothId);
            if (rothClone) rothClone.balance += actualC;
            const fixedOrd = actualC + nonPortfolioTaxableIncome;
            const grossSpend = mode === 'target_spending'
              ? solveAfterTaxSpendTarget(
                  clone.map(s => ({ ...s })),
                  accounts,
                  targetSpending,
                  rmdAmount,
                  totalRetirementIncome,
                  yearProfile,
                  age,
                  countryConfig,
                  fixedOrd,
                  governmentBenefitIncome,
                  inflatedStreamIncome,
                  fixedOrd,
                  bracketInflation,
                  withdrawalStrategy
                )
              : targetSpending;
            const trial = performTaxOptimizedWithdrawal(
              clone.map(s => ({ ...s })),
              accounts,
              grossSpend,
              rmdAmount,
              totalRetirementIncome,
              yearProfile,
              {},
              age,
              countryConfig,
              fixedOrd,
              withdrawalStrategy,
              bracketInflation
            );
            return trial.traditionalWithdrawal;
          };

          // Fixed-point solve: the conversion may only use the bracket room
          // that remains after the spending-driven traditional income it
          // induces (including the gross-up to pay the conversion's own tax).
          // Converges because each extra $1 converted raises that spending
          // income by < $1, so the map is contractive.
          let targetConversion = 0;
          for (let iter = 0; iter < 12; iter++) {
            const spendingTrad = spendingTradForConversion(targetConversion);
            const room = getConversionToTopOfBracket(
              nonPortfolioTaxableIncome + spendingTrad,
              conversionSettings.targetBracketRate,
              filingStatus,
              bracketInflation
            );
            const next = Math.max(
              0,
              Math.min(room, conversionCap, totalTraditionalBalance)
            );
            if (Math.abs(next - targetConversion) < 1) {
              targetConversion = next;
              break;
            }
            targetConversion = next;
          }

          let remaining = targetConversion;
          for (const acc of traditionalStates) {
            if (remaining <= 0) break;
            const convert = Math.min(remaining, acc.balance);
            acc.balance -= convert;
            rothState.balance += convert;
            conversionByAccount[acc.id] = (conversionByAccount[acc.id] || 0) + convert;
            remaining -= convert;
            if (acc.balance <= 0 && accountDepletionAges[acc.id] === null) {
              accountDepletionAges[acc.id] = age;
            }
          }
          rothConversionAmount = targetConversion - remaining;
        }
      }
    }

    // Taxable portions of fixed (non-portfolio) income. Constant across the
    // gross-up solve since they don't depend on the withdrawal amount.
    // Government benefits (Canada CPP/OAS): 85% taxable
    const governmentBenefitTaxable = governmentBenefitIncome * 0.85;
    // Income streams: per-bucket tax rules
    const ssStreamTaxable = inflatedStreamByTax.social_security * 0.85;
    const pensionTaxable = inflatedStreamByTax.fully_taxable;
    const otherIncomeTaxable = inflatedStreamByTax.other_income;
    // tax_free: excluded from taxable income
    const fixedOrdinaryIncome = rothConversionAmount +
      governmentBenefitTaxable + ssStreamTaxable + pensionTaxable + otherIncomeTaxable;

    // In target_spending mode the target is an *after-tax* spending goal. Gross up
    // the withdrawal so spendable cash (withdrawals + SS/pensions − taxes) meets the
    // target. SWR mode keeps classic semantics (withdraw exactly portfolio × rate).
    const solvedSpendTarget = mode === 'target_spending'
      ? solveAfterTaxSpendTarget(
          accountStates.map(s => ({ ...s })),
          accounts,
          targetSpending,
          rmdAmount,
          totalRetirementIncome,
          yearProfile,
          age,
          countryConfig,
          fixedOrdinaryIncome,
          governmentBenefitIncome,
          inflatedStreamIncome,
          nonPortfolioTaxableIncome + rothConversionAmount,
          bracketInflation,
          withdrawalStrategy
        )
      : targetSpending;

    // Tax-optimized withdrawal strategy (committed run against real account states).
    // Pass conversion amount as additional committed ordinary income so bracket-fill
    // logic accounts for income already created by the Roth conversion.
    const withdrawals = performTaxOptimizedWithdrawal(
      accountStates,
      accounts,
      solvedSpendTarget,
      rmdAmount,
      totalRetirementIncome,
      yearProfile,
      accountDepletionAges,
      age,
      countryConfig,
      nonPortfolioTaxableIncome + rothConversionAmount,
      withdrawalStrategy,
      bracketInflation
    );

    // Calculate early withdrawal penalties
    const penalties = countryConfig
      ? calculatePenalties(withdrawals.accountWithdrawals, age, countryConfig)
      : [];
    const totalPenalties = penalties.reduce((sum, p) => sum + p.amount, 0);

    // Apply investment returns to remaining balances
    accountStates.forEach(acc => {
      acc.balance *= (1 + assumptions.retirementReturnRate);
    });

    const ordinaryIncome = withdrawals.traditionalWithdrawal + fixedOrdinaryIncome;
    const capitalGains = withdrawals.taxableGains;
    const { federalTax, stateTax } = computeIncomeTaxes(
      ordinaryIncome,
      capitalGains,
      yearProfile,
      countryConfig,
      bracketInflation
    );
    const totalTax = federalTax + stateTax + totalPenalties;

    // Marginal ordinary-income bracket for this year (inflation-projected).
    const marginalBracket = countryConfig?.getMarginalBracket
      ? countryConfig.getMarginalBracket(ordinaryIncome, effectiveFilingStatus, bracketInflation)
      : getMarginalBracket(ordinaryIncome, effectiveFilingStatus, bracketInflation);
    lifetimeTaxesPaid += totalTax;

    const grossWithdrawal = withdrawals.total;
    // grossIncome = taxable income basis (what taxes are computed on):
    // ordinary income (traditional withdrawals + conversion + taxable SS/pensions) + capital gains.
    // Excludes tax-free Roth withdrawals so it stays comparable to bracket limits.
    const grossIncome = ordinaryIncome + capitalGains;
    // taxableIncome = grossIncome after the (inflation-projected) standard
    // deduction — the amount tax brackets are applied to. Canada applies the
    // basic personal amount as a credit (not a deduction), so its taxable
    // income equals gross income.
    const standardDeductionThisYear = (!countryConfig || countryConfig.code === 'US')
      ? getStandardDeduction(effectiveFilingStatus, bracketInflation)
      : 0;
    const taxableIncome = Math.max(0, grossIncome - standardDeductionThisYear);
    // afterTaxIncome = spendable cash: all spending withdrawals (incl. Roth) + SS/pensions - taxes.
    // Conversion is intentionally excluded — it is a balance transfer, not spendable cash.
    const afterTaxIncome = grossWithdrawal + governmentBenefitIncome + inflatedStreamIncome - totalTax;

    // Record the year's data
    const remainingBalances: Record<string, number> = {};
    accountStates.forEach(acc => {
      remainingBalances[acc.id] = acc.balance;
    });

    yearlyWithdrawals.push({
      age,
      year,
      withdrawals: withdrawals.byAccount,
      conversionByAccount,
      remainingBalances,
      totalWithdrawal: grossWithdrawal,
      governmentBenefitIncome,
      incomeStreamIncome: inflatedStreamIncome,
      grossIncome,
      taxableIncome,
      federalTax,
      stateTax,
      totalTax,
      taxBracket: marginalBracket,
      afterTaxIncome,
      targetSpending,
      rmdAmount,
      rothConversionAmount,
      totalRemainingBalance: accountStates.reduce((sum, acc) => sum + acc.balance, 0),
      earlyWithdrawalPenalties: penalties,
      totalPenalties,
    });

    // Inflate target spending for next year
    targetSpending *= (1 + assumptions.inflationRate);
  }

  // Sustainable withdrawal amounts in today's dollars
  const sustainableAnnualWithdrawal = initialTargetSpending;
  const sustainableMonthlyWithdrawal = sustainableAnnualWithdrawal / 12;

  return {
    yearlyWithdrawals,
    portfolioDepletionAge,
    lifetimeTaxesPaid,
    sustainableMonthlyWithdrawal,
    sustainableAnnualWithdrawal,
    effectiveWithdrawalRate,
    accountDepletionAges,
  };
}

interface WithdrawalResult {
  total: number;
  traditionalWithdrawal: number;
  rothWithdrawal: number;
  taxableWithdrawal: number;
  taxableGains: number;
  hsaWithdrawal: number;
  byAccount: Record<string, number>;
  accountWithdrawals: AccountWithdrawal[];  // NEW: for penalty calculation
}

function performTaxOptimizedWithdrawal(
  accountStates: AccountState[],
  accounts: Account[],
  targetSpending: number,
  rmdAmount: number,
  totalRetirementIncome: number,
  profile: Profile,
  accountDepletionAges: Record<string, number | null>,
  age: number,
  countryConfig?: CountryConfig,
  nonPortfolioTaxableIncome?: number,
  strategy?: WithdrawalStrategySettings,
  bracketInflation = 1
): WithdrawalResult {
  const fillTaxBracket = strategy?.fillTaxBracket ?? true;
  const withdrawalOrder: AccountTypeGroup[] = strategy?.withdrawalOrder ?? ['roth', 'taxable', 'hsa', 'traditional'];

  const result: WithdrawalResult = {
    total: 0,
    traditionalWithdrawal: 0,
    rothWithdrawal: 0,
    taxableWithdrawal: 0,
    taxableGains: 0,
    hsaWithdrawal: 0,
    byAccount: {},
    accountWithdrawals: [],
  };

  accountStates.forEach(acc => {
    result.byAccount[acc.id] = 0;
  });

  const recordWithdrawal = (acc: AccountState, amount: number) => {
    const account = accounts.find(a => a.id === acc.id);
    if (account && amount > 0) {
      result.accountWithdrawals.push({
        accountId: acc.id,
        accountName: account.name,
        accountType: acc.type,
        amount,
      });
    }
  };

  let remainingNeed = Math.max(0, targetSpending - totalRetirementIncome);

  const availableAccounts = getAvailableAccounts(
    accountStates,
    accounts,
    age,
    profile.retirementAge,
    countryConfig
  );

  const isTraditionalAccount = (type: string) =>
    countryConfig ? countryConfig.isTraditionalAccount(type) : isTraditional(type);

  const traditionalAccounts = availableAccounts.filter(acc => isTraditionalAccount(acc.type));

  // Helper: withdraw from a single account state, updating result totals
  const withdrawFrom = (acc: AccountState, amount: number) => {
    if (amount <= 0) return;
    const treatment = getTaxTreatment(acc.type);

    // Compute taxable gains BEFORE reducing balance
    if (treatment === 'taxable') {
      const gainRatio = acc.costBasis > 0 ? Math.max(0, 1 - acc.costBasis / acc.balance) : 0.5;
      result.taxableGains += amount * gainRatio;
      result.taxableWithdrawal += amount;
      acc.balance -= amount;
      if (acc.balance > 0) {
        acc.costBasis *= (acc.balance / (acc.balance + amount));
      } else {
        acc.costBasis = 0;
      }
    } else {
      acc.balance -= amount;
      if (isTraditionalAccount(acc.type)) {
        result.traditionalWithdrawal += amount;
      } else if (treatment === 'roth') {
        result.rothWithdrawal += amount;
      } else if (treatment === 'hsa') {
        result.hsaWithdrawal += amount;
      }
    }

    result.byAccount[acc.id] += amount;
    result.total += amount;
    recordWithdrawal(acc, amount);
    if (acc.balance <= 0 && accountDepletionAges[acc.id] === null) {
      accountDepletionAges[acc.id] = age;
    }
  };

  // Step 1: RMDs from traditional accounts (required by law)
  let rmdRemaining = rmdAmount;
  for (const acc of traditionalAccounts) {
    if (rmdRemaining <= 0) break;
    const withdrawal = Math.min(rmdRemaining, acc.balance);
    withdrawFrom(acc, withdrawal);
    rmdRemaining -= withdrawal;
    remainingNeed = Math.max(0, remainingNeed - withdrawal);
  }

  // Step 2: Fill tax bracket with traditional withdrawals (optional)
  if (fillTaxBracket) {
    const filingStatus = profile.filingStatus || 'single';
    const standardDeduction = getStandardDeduction(filingStatus, bracketInflation);
    // Top of the 2026 12% bracket, projected forward by inflation
    const bracket12Max = (filingStatus === 'married_filing_jointly' ? 100800 : 50400) * bracketInflation;
    const targetOrdinaryIncome = standardDeduction + bracket12Max;
    const currentOrdinaryIncome = result.traditionalWithdrawal + (nonPortfolioTaxableIncome || 0);
    const roomIn12Bracket = Math.max(0, targetOrdinaryIncome - currentOrdinaryIncome);
    let bracketFill = Math.min(roomIn12Bracket, remainingNeed);

    for (const acc of traditionalAccounts) {
      if (bracketFill <= 0) break;
      const withdrawal = Math.min(bracketFill, acc.balance);
      withdrawFrom(acc, withdrawal);
      bracketFill -= withdrawal;
      remainingNeed -= withdrawal;
    }
  }

  // Step 3: Draw from accounts in user-configured order
  const groupAccounts = (group: AccountTypeGroup): AccountState[] => {
    switch (group) {
      case 'traditional':
        return availableAccounts.filter(acc => isTraditionalAccount(acc.type));
      case 'roth':
        return availableAccounts.filter(acc => getTaxTreatment(acc.type) === 'roth');
      case 'taxable':
        return availableAccounts.filter(acc => getTaxTreatment(acc.type) === 'taxable');
      case 'hsa':
        return availableAccounts.filter(acc => getTaxTreatment(acc.type) === 'hsa');
    }
  };

  for (const group of withdrawalOrder) {
    if (remainingNeed <= 0) break;
    for (const acc of groupAccounts(group)) {
      if (remainingNeed <= 0) break;
      const withdrawal = Math.min(remainingNeed, acc.balance);
      withdrawFrom(acc, withdrawal);
      remainingNeed -= withdrawal;
    }
  }

  // Step 4: Last resort — use unavailable accounts (triggers early withdrawal penalties)
  if (remainingNeed > 0) {
    const unavailableAccounts = accountStates.filter(state => {
      const account = accounts.find(a => a.id === state.id);
      if (!account) return false;
      const withdrawalAge = account.withdrawalRules?.startAge ??
        (countryConfig
          ? getDefaultWithdrawalAge(account, profile.retirementAge, countryConfig)
          : profile.retirementAge);
      return age < withdrawalAge && state.balance > 0;
    });

    // Traditional penalty accounts first
    for (const acc of unavailableAccounts.filter(acc => isTraditionalAccount(acc.type))) {
      if (remainingNeed <= 0) break;
      const withdrawal = Math.min(remainingNeed, acc.balance);
      withdrawFrom(acc, withdrawal);
      remainingNeed -= withdrawal;
    }

    // Then other unavailable account types
    for (const acc of unavailableAccounts.filter(acc => !isTraditionalAccount(acc.type))) {
      if (remainingNeed <= 0) break;
      const withdrawal = Math.min(remainingNeed, acc.balance);
      withdrawFrom(acc, withdrawal);
      remainingNeed -= withdrawal;
    }
  }

  return result;
}
