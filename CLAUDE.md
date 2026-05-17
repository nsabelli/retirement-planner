# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation Updates (MANDATORY)

On **every** change to behavior, calculations, features, types, or project structure, you MUST update both `README.md` and this `CLAUDE.md` in the same change so the docs never drift from the code. This is not optional — treat doc updates as part of the definition of done for any code change.

## Commands

```bash
npm run dev      # Start development server
npm run build    # TypeScript check + production build
npm run lint     # ESLint
npm test         # Run calculation tests
```

## Architecture

This is a React retirement planning calculator that projects portfolio growth and simulates tax-optimized withdrawals.

### Core Calculation Flow

1. **Accumulation Phase** (`src/utils/projections.ts`): Projects account growth from current age to retirement using compound interest, annual contributions, contribution growth rates, and employer matching.

2. **Withdrawal Phase** (`src/utils/withdrawals.ts`): Simulates retirement spending with a tax-optimized withdrawal strategy:
   - Optionally performs Roth conversions (pre-RMD years only) up to the user-selected bracket top
   - In `target_spending` mode, grosses up the withdrawal so after-tax spendable cash meets the target (see Withdrawal Target Mode)
   - Takes Required Minimum Distributions (RMDs) from traditional accounts first (age 73+)
   - Fills 12% tax bracket with additional traditional withdrawals
   - Uses Roth accounts (tax-free)
   - Uses taxable accounts (with capital gains tracking)
   - Uses HSA last
   - Falls back to additional traditional withdrawals if needed

3. **Tax Calculations** (`src/utils/taxes.ts`): Computes federal income tax, capital gains tax, and state tax using 2024 brackets.

### Data Flow

- `App.tsx` holds state for accounts, profile, and assumptions (persisted to localStorage via `useLocalStorage` hook)
- `useRetirementCalc` hook orchestrates calculations, returning `AccumulationResult` and `RetirementResult`
- Chart components receive results and render visualizations using Recharts

### Key Types (`src/types/index.ts`)

- `Account`: Investment account with balance, contributions, return rate, type (traditional_401k, roth_ira, etc.)
- `Profile`: User info including ages, filing status, Social Security
- `Assumptions`: Economic parameters (inflation, withdrawal rate, retirement return, withdrawal mode, target monthly spending)
- `AccumulationResult` / `RetirementResult`: Yearly projections with balances, withdrawals, taxes, effective withdrawal rate
- `YearlyWithdrawal`: Per-year retirement data including `conversionByAccount` (per-account Roth conversion outflows, separate from spending withdrawals)

### Key Features

**Roth Conversion Strategy (`WithdrawalStrategySettings.rothConversion`):**
- Runs each year before RMD age; converts from traditional accounts to Roth up to the top of the user-selected tax bracket
- Bracket room = `getConversionToTopOfBracket(nonPortfolioTaxableIncome, targetBracketRate, filingStatus)` in `taxes.ts`
  - Returns gross income room = `(targetBracket.max − currentTaxable) + deductionRoom`
  - Accounts for existing ordinary income (SS, pensions) before computing room
- Safety check: conversion only proceeds if `availableNonTraditional + bracketRoom ≥ spendingNeed`; otherwise spending would force traditional withdrawals that exceed the bracket regardless, so conversion is skipped
  - In `target_spending` mode, `spendingNeed` is sized against the **grossed-up** withdrawal (via `solveAfterTaxSpendTarget` on a pre-conversion snapshot), not the raw after-tax target, so the guard doesn't under-size the need and convert unsafely
- Optional `maxAnnualConversion` cap applied after bracket room is computed
- Per-account conversion outflows tracked in `conversionByAccount` (stored on `YearlyWithdrawal`)
- `grossTaxableIncome = ordinaryIncome + capitalGains` (includes conversion; excludes tax-free Roth spending)
- `afterTaxIncome = grossWithdrawal + SS + pensions − totalTax` (spendable cash; conversion excluded as it is not spendable)

**Year-by-Year Data Table (`DataTableWithdrawal.tsx`) — column definitions:**
- *Income & Spending*: Withdrawals = spending from portfolio (excl. conversion) | Gross Taxable Income = `ordinaryIncome + capitalGains` | After-Tax Spendable = portfolio spending + SS/pensions − taxes
- *Withdrawals by Account*: per-account column = spending withdrawal + Roth conversion outflow; Total = both combined
- *Tax Details*: Gross Taxable Income same as above; Effective Rate = `totalTax ÷ grossTaxableIncome`

**Withdrawal Target Mode (`Assumptions.withdrawalMode`):**
- Two modes: `'swr'` (safe withdrawal rate) and `'target_spending'` (target monthly spending in USD)
- In `swr` mode: `targetSpending = totalPortfolio × safeWithdrawalRate`. This is a **gross** withdrawal — classic SWR semantics; after-tax spendable will be below the target by the tax owed
- In `target_spending` mode: `targetSpending = targetMonthlySpending × 12` (today's dollars, inflation-adjusted each year). This is an **after-tax** spending goal — the withdrawal is grossed up so `withdrawals + SS/pensions − totalTax ≈ targetSpending`
- Gross-up is solved iteratively by `solveAfterTaxSpendTarget` (a larger withdrawal raises taxes, which raises the need). It runs trial withdrawals on cloned account states (never mutates real state), stops at `< $1` shortfall, max 20 iterations, and bails early when the portfolio is exhausted (withdrawal can't grow). Federal/state tax is shared via the extracted `computeIncomeTaxes` helper
- `effectiveWithdrawalRate` is always returned in `RetirementResult`: equals the SWR in `swr` mode, or `annualTarget / totalPortfolio` in `target_spending` mode
- Dashboard shows both the monthly withdrawal amount and effective withdrawal rate regardless of mode
- Toggle UI in `AssumptionsForm.tsx`; mode/target logic in `calculateWithdrawals` and the `solveAfterTaxSpendTarget` / `computeIncomeTaxes` helpers in `withdrawals.ts`

**Configurable Withdrawal Ages:**
- Each account has optional `withdrawalRules: { startAge: number }`
- Defaults are smart: traditional accounts default to 60 (US) or retirement age (Canada)
- Validation enforces RMD age constraints (can't delay past age 73 US, 71 Canada)
- Early withdrawals trigger 10% penalty for US traditional accounts before age 59.5

**Known Simplifications (Penalty Calculations):**
- Roth contributions vs earnings not tracked separately. In reality, Roth contributions can be withdrawn penalty-free at any time; only earnings face the 10% penalty before age 59.5.
- HSA non-medical penalty (20% before age 65) not implemented. HSA withdrawals are modeled as penalty-free.
- 5-year rule for Roth accounts not tracked. Account opening dates are not stored.

### Tailwind v4

Uses `@tailwindcss/vite` plugin. Dark mode requires this CSS directive:
```css
@custom-variant dark (&:where(.dark, .dark *));
```

### Chart Components

All chart components accept `isDarkMode` prop for proper axis/legend coloring. Pass from App.tsx which manages dark mode state.
