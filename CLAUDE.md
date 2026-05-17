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

3. **Tax Calculations** (`src/utils/taxes.ts`, `src/countries/usa/taxes.ts`): Computes federal income tax, capital gains tax, and state tax. US brackets/standard deduction/capital-gains thresholds are **2026 IRS values** (Rev. Proc. 2025-32) and are **inflation-projected** per year (see Inflation-Indexed Tax Brackets below).

### Data Flow

- `useScenarios` hook (`src/hooks/useScenarios.ts`) is the primary state store. All user-enterable data lives inside a `Scenario` object in a `retirement-planner-scenarios` localStorage array. The active scenario ID is stored at `retirement-planner-active-scenario-id`.
- `App.tsx` (`AppContent`) reads from `useScenarios`, passes data to child components, and writes back via the hook's setters (which auto-save to the active scenario).
- `useRetirementCalc` hook orchestrates calculations, returning `AccumulationResult` and `RetirementResult`
- Chart components receive results and render visualizations using Recharts

### Key Types (`src/types/index.ts`)

- `Account`: Investment account with balance, contributions, return rate, type (traditional_401k, roth_ira, etc.)
- `Profile`: User info including ages, filing status (with optional `filingStatusChangeAge` / `filingStatusAfterChange` for widow-penalty simulation), Social Security
- `Assumptions`: Economic parameters (inflation, withdrawal rate, retirement return, withdrawal mode, target monthly spending)
- `AccumulationResult` / `RetirementResult`: Yearly projections with balances, withdrawals, taxes, effective withdrawal rate
- `YearlyWithdrawal`: Per-year retirement data including `conversionByAccount` (per-account Roth conversion outflows, separate from spending withdrawals) and `taxBracket` (the year's marginal ordinary-income `TaxBracket` with inflation-projected nominal `min`/`max`)
- `Scenario`: Named snapshot of all user-enterable state — `id`, `name`, `createdAt`, `country`, `accounts`, `profile`, `assumptions`, `incomeStreams`, `withdrawalStrategy`

### Scenarios Feature

- **Storage**: `retirement-planner-scenarios: Scenario[]` + `retirement-planner-active-scenario-id: string`
- **Migration**: On first load with no scenarios key, `useScenarios` reads legacy individual localStorage keys (`retirement-planner-accounts`, `-profile`, etc.) into a "My Plan" scenario automatically.
- **Auto-save**: Every setter call (e.g. `setProfile`, `setAccounts`) patches the active scenario in-place — no explicit save step.
- **`useScenarios` hook** (`src/hooks/useScenarios.ts`): exports `createDefaultScenarioData(country)` (shared with the outer `App` country-change handler), `loadScenario`, `createScenario`, `renameScenario`, `deleteScenario`, and per-field setters.
- **`ScenarioSelector` component** (`src/components/ScenarioSelector.tsx`): rendered in `Layout` header next to `CountrySelector`. Provides a `<select>` dropdown to switch scenarios, rename (inline edit), "+ New" (inline panel with "Copy current" and "Start from defaults" options), and delete (inline confirm, disabled when only one scenario exists).
- **Country switching when loading a scenario**: `AppContent` calls `setCountryDirect` (added to `CountryContext`) before `loadScenario` when the target scenario has a different country. `setCountryDirect` bypasses the confirm dialog and `onCountryChange` callback — it's purely a programmatic context update.
- **Country switching via `CountrySelector`**: unchanged — triggers the confirm dialog, then the outer `App.handleCountryChange` writes updated scenario data (with country defaults) to `retirement-planner-scenarios` in localStorage and reloads.

### Key Features

**Filing Status Change / Widow Penalty (`Profile.filingStatusChangeAge` + `filingStatusAfterChange`):**
- US-only optional setting in Personal Information: a checkbox ("Filing status changes during retirement") exposes an age input and a target-status dropdown.
- Adds `filingStatusChangeAge?: number` and `filingStatusAfterChange?: FilingStatus` to `Profile`.
- In `calculateWithdrawals` (`withdrawals.ts`), each year of the retirement loop computes `effectiveFilingStatus` — if the current age ≥ `filingStatusChangeAge`, the new status applies; otherwise the original `filingStatus` is used.
- A `yearProfile` is created (shallow-cloned with the overridden `filingStatus`) and passed to every helper that uses filing status: `computeIncomeTaxes`, `performTaxOptimizedWithdrawal`, `solveAfterTaxSpendTarget`, `getStandardDeduction`, `getMarginalBracket`, `getConversionToTopOfBracket`. The Roth-conversion local `filingStatus` variable also uses `effectiveFilingStatus`. This ensures bracket widths, standard deduction, capital-gains thresholds, and Roth-conversion headroom all switch in the correct year.
- Typical use: MFJ → Single at a specified age to model the higher tax burden a surviving spouse faces (narrower brackets, smaller standard deduction, lower capital-gains thresholds).

**Roth Conversion Strategy (`WithdrawalStrategySettings.rothConversion`):**
- Runs each year before RMD age; converts from traditional accounts to Roth up to the top of the user-selected tax bracket
- The conversion may only use the bracket room that **remains after the ordinary income generated by funding the spendable target — including the gross-up to pay the conversion's own tax**. This is a fixed point (a larger conversion ⇒ more tax ⇒ bigger gross-up ⇒ more spending-driven traditional income ⇒ less room), solved iteratively in `withdrawals.ts`:
  - `spendingTradForConversion(C)`: clone the pre-conversion snapshot, apply conversion `C` (traditional→Roth), set `fixedOrd = C + nonPortfolioTaxableIncome`, run `solveAfterTaxSpendTarget` (target_spending) / use `targetSpending` (swr), then one `performTaxOptimizedWithdrawal` — returns the committed `trial.traditionalWithdrawal` that funding the target induces at conversion `C`
  - Iterate (≤12×, $1 tol): `C ← clamp(getConversionToTopOfBracket(nonPortfolioTaxableIncome + spendingTradForConversion(C), targetBracketRate, filingStatus, bracketInflation), 0, maxAnnualConversion, totalTraditionalBalance)`. Contractive because each extra $1 converted raises the induced spending income by < $1, so it converges to filling exactly to the bracket top
- This replaces the earlier no-conversion-trial approach, which ignored that the conversion's tax drives extra traditional withdrawals (via the gross-up) and overshot the selected bracket
- `getConversionToTopOfBracket` returns gross income room = `(targetBracket.max − currentTaxable) + deductionRoom`, accounting for existing ordinary income before computing room
- `getMarginalBracket` (US config + `utils/taxes` fallback) uses a **$1 tolerance** (`taxable ≤ bracket.max + 1`) so income filled exactly to a bracket top reads as that bracket (not the next) — matches a conversion that fills the selected bracket and avoids float jitter
- Per-account conversion outflows tracked in `conversionByAccount` (stored on `YearlyWithdrawal`)
- `grossIncome = ordinaryIncome + capitalGains` (includes conversion; excludes tax-free Roth spending). `taxableIncome = max(0, grossIncome − standardDeduction)` where the standard deduction is inflation-projected (US); for Canada `taxableIncome = grossIncome` (basic personal amount is a credit, not a deduction). Both stored on `YearlyWithdrawal`.
- `afterTaxIncome = grossWithdrawal + SS + pensions − totalTax` (spendable cash; conversion excluded as it is not spendable)

**Estate Planning Section (`SummaryCards.tsx`):**
- New "Estate Planning (Age {lifeExpectancy})" summary section with two expandable cards:
  - *Total Portfolio*: `lastYear.totalRemainingBalance` — nominal balance at the simulation's final year; expanded view shows inflation-adjusted (today's dollars) equivalent
  - *Tax-Free Balance (Roth / TFSA)*: sum of `remainingBalances` for accounts whose `getTaxTreatment()` returns `'roth'`; shows percentage of total estate; expanded view notes taxable portion and prompts Roth conversion consideration if $0
- `SummaryCards` now accepts an `accounts: Account[]` prop (passed from `App.tsx`) to resolve per-account tax treatment at longevity

**Year-by-Year Data Table (`DataTableWithdrawal.tsx`) — column definitions:**
- `DataTableWithdrawal` accepts `inflationRate: number` (passed from `App.tsx`) used to project bracket ranges in the Tax Brackets tab
- *Income & Spending*: Withdrawals = spending from portfolio (excl. conversion) | Gross Income = `ordinaryIncome + capitalGains` | Taxable Income = `Gross Income − standardDeduction` (inflation-projected) | After-Tax Spendable = portfolio spending + SS/pensions − taxes
- *Withdrawals by Account*: per-account column = spending withdrawal + Roth conversion outflow; Total = both combined
- *Tax Details*: Gross Income & Taxable Income as above (separate columns); **Tax Bracket** (after Total Tax) = the year's marginal ordinary-income bracket **rate only** (e.g. `22%`); Effective Rate = `totalTax ÷ grossIncome`
- *All Columns*: Tax Bracket column also shows rate only (no range) — ranges are in the Tax Brackets tab
- *Tax Brackets* (US only): per-year table with two grouped sections (Single | Married Filing Jointly), one column per bracket rate (10%–37%), showing the inflation-projected nominal dollar range for that year. `bracketInflation = (1 + inflationRate)^max(0, year − 2026)` applied to `TAX_BRACKETS_SINGLE` and `TAX_BRACKETS_MFJ` from `src/countries/usa/constants.ts`. Tab is hidden for Canada.
- The Tax Bracket column also appears in the *All Columns* view, immediately after Total Tax. Lifetime-total footer shows `-` for it.

**Inflation-Indexed Tax Brackets:**
- US federal brackets, standard deduction, and capital-gains thresholds in `src/utils/constants.ts` and `src/countries/usa/constants.ts` are **2026 IRS values** (Rev. Proc. 2025-32). Keep both files in sync.
- `TAX_BASE_YEAR = 2026` in `withdrawals.ts`. Per projection year, `bracketInflation = (1 + inflationRate) ^ max(0, year − 2026)` scales bracket `min`/`max` and the standard deduction, mirroring the IRS's annual inflation indexing so brackets keep pace with inflated (nominal) income.
- `bracketInflation` is threaded through `computeIncomeTaxes`, `solveAfterTaxSpendTarget`, `performTaxOptimizedWithdrawal` (12%-fill uses 2026 tops 100800 MFJ / 50400 single × inflation), and `getConversionToTopOfBracket`. The US tax fns (`countries/usa/taxes.ts`, `utils/taxes.ts`) take an optional trailing `bracketInflation = 1` and scale via a local `scaleBrackets` helper.
- `CountryConfig.calculateFederalTax` / `calculateCapitalGainsTax` gained an optional trailing `bracketInflation?` arg; new optional `getMarginalBracket(ordinaryIncome, filingStatus, bracketInflation)` returns the year's marginal `TaxBracket`. Canada ignores `bracketInflation` (its brackets stay 2024 static — a known simplification).
- The per-year marginal bracket stored on `YearlyWithdrawal.taxBracket` comes from `countryConfig.getMarginalBracket` (US) or the `getMarginalBracket` fallback in `utils/taxes.ts`.

**Withdrawal Target Mode (`Assumptions.withdrawalMode`):**
- Two modes: `'swr'` (safe withdrawal rate) and `'target_spending'` (target monthly spending in USD)
- In `swr` mode: `targetSpending = totalPortfolio × safeWithdrawalRate`. This is a **gross** withdrawal — classic SWR semantics; after-tax spendable will be below the target by the tax owed
- In `target_spending` mode: the user enters `targetMonthlySpending` in **today's dollars**. `initialTargetSpending = targetMonthlySpending × 12 × (1 + inflationRate)^yearsToRetirement` — inflated to the first year of retirement before the simulation starts, so the per-year inflation growth (`targetSpending *= 1 + inflationRate`) continues correctly from there. This is an **after-tax** spending goal — the withdrawal is grossed up so `withdrawals + SS/pensions − totalTax ≈ targetSpending`
- Gross-up is solved iteratively by `solveAfterTaxSpendTarget` (a larger withdrawal raises taxes, which raises the need). It runs trial withdrawals on cloned account states (never mutates real state), stops at `< $1` shortfall, max 20 iterations, and bails early when the portfolio is exhausted (withdrawal can't grow). Federal/state tax is shared via the extracted `computeIncomeTaxes` helper
- `effectiveWithdrawalRate` is always returned in `RetirementResult`: equals the SWR in `swr` mode, or `nominalFirstYearAnnual / totalPortfolio` in `target_spending` mode
- `sustainableMonthlyWithdrawal` / `sustainableAnnualWithdrawal` in `target_spending` mode are the **nominal year-1** amounts (inflation-adjusted). `SummaryCards` displays today's dollars (`targetMonthlySpending`) as the card value and shows the nominal year-1 amount in the expanded detail; the effective withdrawal rate formula uses the nominal year-1 figure ÷ portfolio
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
