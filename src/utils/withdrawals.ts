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

  // Calculate initial target spending based on safe withdrawal rate
  const totalPortfolio = accumulationResult.totalAtRetirement;
  let targetSpending = totalPortfolio * assumptions.safeWithdrawalRate;

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

    // Tax-optimized withdrawal strategy
    const withdrawals = performTaxOptimizedWithdrawal(
      accountStates,
      accounts,
      targetSpending,
      rmdAmount,
      totalRetirementIncome,
      profile,
      accountDepletionAges,
      age,
      countryConfig,
      nonPortfolioTaxableIncome,
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

    // Calculate taxes using country-specific logic
    // Government benefits (Canada CPP/OAS): 85% taxable
    const governmentBenefitTaxable = governmentBenefitIncome * 0.85;
    // Income streams: per-bucket tax rules
    const ssStreamTaxable = inflatedStreamByTax.social_security * 0.85;
    const pensionTaxable = inflatedStreamByTax.fully_taxable;
    const otherIncomeTaxable = inflatedStreamByTax.other_income;
    // tax_free: excluded from taxable income

    const ordinaryIncome = withdrawals.traditionalWithdrawal +
      governmentBenefitTaxable + ssStreamTaxable + pensionTaxable + otherIncomeTaxable;
    const capitalGains = withdrawals.taxableGains;

    let federalTax: number;
    let stateTax: number;

    if (countryConfig) {
      // Use country-specific tax calculations
      federalTax = countryConfig.calculateFederalTax(ordinaryIncome, profile.filingStatus);
      // Add capital gains tax (country handles inclusion rates)
      federalTax += countryConfig.calculateCapitalGainsTax(
        capitalGains,
        ordinaryIncome,
        profile.region || '',
        profile.filingStatus
      );
      // Calculate regional (state/provincial) tax
      stateTax = countryConfig.calculateRegionalTax(
        ordinaryIncome + capitalGains,
        profile.region || ''
      );
      // For US, regional tax is still calculated using flat rate from profile
      // (the US config returns 0 from calculateRegionalTax)
      if (countryConfig.code === 'US') {
        stateTax = calculateStateTax(
          ordinaryIncome + capitalGains - getStandardDeduction(profile.filingStatus || 'single'),
          profile.stateTaxRate || 0
        );
      }
    } else {
      // Fallback to US logic
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
    const totalTax = federalTax + stateTax + totalPenalties;
    lifetimeTaxesPaid += totalTax;

    const grossWithdrawal = withdrawals.total;
    const grossIncome = grossWithdrawal + governmentBenefitIncome + inflatedStreamIncome;
    const afterTaxIncome = grossIncome - totalTax;

    // Record the year's data
    const remainingBalances: Record<string, number> = {};
    accountStates.forEach(acc => {
      remainingBalances[acc.id] = acc.balance;
    });

    yearlyWithdrawals.push({
      age,
      year,
      withdrawals: withdrawals.byAccount,
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
      totalRemainingBalance: accountStates.reduce((sum, acc) => sum + acc.balance, 0),
      earlyWithdrawalPenalties: penalties,
      totalPenalties,
    });

    // Inflate target spending for next year
    targetSpending *= (1 + assumptions.inflationRate);
  }

  // Calculate sustainable withdrawal amounts in today's dollars
  const sustainableAnnualWithdrawal = totalPortfolio * assumptions.safeWithdrawalRate;
  const sustainableMonthlyWithdrawal = sustainableAnnualWithdrawal / 12;

  return {
    yearlyWithdrawals,
    portfolioDepletionAge,
    lifetimeTaxesPaid,
    sustainableMonthlyWithdrawal,
    sustainableAnnualWithdrawal,
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
