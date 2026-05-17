import {
  Account,
  Profile,
  Assumptions,
  AccumulationResult,
  RetirementResult,
  YearlyWithdrawal,
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
} from './taxes';
import { getRMDDivisor, RMD_START_AGE } from './constants';
import type { CountryConfig } from '../countries';
import { calculatePenalties, type AccountWithdrawal } from './penaltyCalculator';
import { getDefaultWithdrawalAge } from './withdrawalDefaults';
import { calculateIncomeStreamBenefits } from './incomeStreams';

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
  countryConfig?: CountryConfig
): { federalTax: number; stateTax: number } {
  let federalTax: number;
  let stateTax: number;

  if (countryConfig) {
    federalTax = countryConfig.calculateFederalTax(ordinaryIncome, profile.filingStatus);
    federalTax += countryConfig.calculateCapitalGainsTax(
      capitalGains,
      ordinaryIncome,
      profile.region || '',
      profile.filingStatus
    );
    stateTax = countryConfig.calculateRegionalTax(
      ordinaryIncome + capitalGains,
      profile.region || ''
    );
    if (countryConfig.code === 'US') {
      stateTax = calculateStateTax(
        ordinaryIncome + capitalGains - getStandardDeduction(profile.filingStatus || 'single'),
        profile.stateTaxRate || 0
      );
    }
  } else {
    federalTax = calculateTotalFederalTax(
      ordinaryIncome,
      capitalGains,
      profile.filingStatus || 'single'
    );
    stateTax = calculateStateTax(
      ordinaryIncome + capitalGains - getStandardDeduction(profile.filingStatus || 'single'),
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
      strategy
    );
    const trialPenalties = countryConfig
      ? calculatePenalties(trial.accountWithdrawals, age, countryConfig)
      : [];
    const trialPenaltyTotal = trialPenalties.reduce((sum, p) => sum + p.amount, 0);
    const { federalTax: tFed, stateTax: tState } = computeIncomeTaxes(
      trial.traditionalWithdrawal + fixedOrdinaryIncome,
      trial.taxableGains,
      profile,
      countryConfig
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
  const initialTargetSpending = mode === 'target_spending' && assumptions.targetMonthlySpending
    ? assumptions.targetMonthlySpending * 12
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
          const filingStatus = profile.filingStatus || 'single';
          const bracketRoom = getConversionToTopOfBracket(
            nonPortfolioTaxableIncome,
            conversionSettings.targetBracketRate,
            filingStatus
          );

          // Ensure the conversion doesn't push total ordinary income above the target
          // bracket. After conversion, spending comes from the grown Roth balance.
          // If non-traditional assets (including the conversion growing Roth) can cover
          // the full spending need, traditional withdrawals for spending are $0 and the
          // bracket limit holds. Otherwise the spending shortfall forces traditional
          // withdrawals that blow past the bracket regardless, so skip converting.
          // In target_spending mode the gross withdrawal is grossed up for taxes, so
          // size the spending need against that real (higher) gross, not the after-tax
          // target — otherwise the guard underestimates the need and converts unsafely.
          const grossSpendTarget = mode === 'target_spending'
            ? solveAfterTaxSpendTarget(
                accountStates.map(s => ({ ...s })),
                accounts,
                targetSpending,
                rmdAmount,
                totalRetirementIncome,
                profile,
                age,
                countryConfig,
                nonPortfolioTaxableIncome,
                governmentBenefitIncome,
                inflatedStreamIncome,
                nonPortfolioTaxableIncome,
                withdrawalStrategy
              )
            : targetSpending;
          const spendingNeed = Math.max(0, grossSpendTarget - totalRetirementIncome);
          const availableNonTraditional = accountStates
            .filter(acc => !isTraditionalAccount(acc.type))
            .reduce((sum, acc) => sum + acc.balance, 0);
          const room = (availableNonTraditional + bracketRoom >= spendingNeed)
            ? bracketRoom
            : 0;

          let targetConversion = room;
          if (conversionSettings.maxAnnualConversion > 0) {
            targetConversion = Math.min(targetConversion, conversionSettings.maxAnnualConversion);
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
          profile,
          age,
          countryConfig,
          fixedOrdinaryIncome,
          governmentBenefitIncome,
          inflatedStreamIncome,
          nonPortfolioTaxableIncome + rothConversionAmount,
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
      profile,
      accountDepletionAges,
      age,
      countryConfig,
      nonPortfolioTaxableIncome + rothConversionAmount,
      withdrawalStrategy
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
      profile,
      countryConfig
    );
    const totalTax = federalTax + stateTax + totalPenalties;
    lifetimeTaxesPaid += totalTax;

    const grossWithdrawal = withdrawals.total;
    // grossIncome = taxable income basis (what taxes are computed on):
    // ordinary income (traditional withdrawals + conversion + taxable SS/pensions) + capital gains.
    // Excludes tax-free Roth withdrawals so it stays comparable to bracket limits.
    const grossIncome = ordinaryIncome + capitalGains;
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
      federalTax,
      stateTax,
      totalTax,
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
  strategy?: WithdrawalStrategySettings
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
    const standardDeduction = getStandardDeduction(filingStatus);
    const bracket12Max = filingStatus === 'married_filing_jointly' ? 94300 : 47150;
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
