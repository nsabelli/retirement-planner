import { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type {
  Account,
  Profile,
  Assumptions,
  IncomeStream,
  WithdrawalStrategySettings,
  Scenario,
} from '../types';
import type { CountryCode } from '../countries';
import {
  DEFAULT_PROFILE,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_INCOME_STREAMS,
  DEFAULT_WITHDRAWAL_STRATEGY,
} from '../utils/constants';
import { getCountryConfig } from '../countries';

const SCENARIOS_KEY = 'retirement-planner-scenarios';
const ACTIVE_ID_KEY = 'retirement-planner-active-scenario-id';

// Legacy individual keys — read once for migration, never written
const LEGACY_COUNTRY_KEY = 'retirement-planner-country';
const LEGACY_ACCOUNTS_KEY = 'retirement-planner-accounts';
const LEGACY_PROFILE_KEY = 'retirement-planner-profile';
const LEGACY_ASSUMPTIONS_KEY = 'retirement-planner-assumptions';
const LEGACY_INCOME_STREAMS_KEY = 'retirement-planner-income-streams';
const LEGACY_WITHDRAWAL_STRATEGY_KEY = 'retirement-planner-withdrawal-strategy';

// --- Default data helpers (duplicated from App.tsx so the hook is self-contained) ---

function createUSDefaultAccounts(): Account[] {
  return [
    {
      id: uuidv4(),
      name: 'Company 401(k)',
      type: 'traditional_401k',
      balance: 150000,
      annualContribution: 15000,
      contributionGrowthRate: 0.03,
      returnRate: 0.07,
      employerMatchPercent: 0.5,
      employerMatchLimit: 3000,
    },
    {
      id: uuidv4(),
      name: 'Roth IRA',
      type: 'roth_ira',
      balance: 40000,
      annualContribution: 7000,
      contributionGrowthRate: 0,
      returnRate: 0.07,
    },
  ];
}

function createCADefaultAccounts(): Account[] {
  return [
    {
      id: uuidv4(),
      name: 'Employer RRSP',
      type: 'employer_rrsp',
      balance: 150000,
      annualContribution: 15000,
      contributionGrowthRate: 0.03,
      returnRate: 0.07,
      employerMatchPercent: 0.5,
      employerMatchLimit: 3000,
    },
    {
      id: uuidv4(),
      name: 'TFSA',
      type: 'tfsa',
      balance: 40000,
      annualContribution: 7000,
      contributionGrowthRate: 0,
      returnRate: 0.07,
    },
  ];
}

export function createDefaultScenarioData(country: CountryCode): Omit<Scenario, 'id' | 'name' | 'createdAt'> {
  const countryConfig = getCountryConfig(country);
  return {
    country,
    accounts: country === 'CA' ? createCADefaultAccounts() : createUSDefaultAccounts(),
    profile: { ...DEFAULT_PROFILE, ...countryConfig.getDefaultProfile() } as Profile,
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    incomeStreams: country === 'US' ? [...DEFAULT_INCOME_STREAMS] : [],
    withdrawalStrategy: { ...DEFAULT_WITHDRAWAL_STRATEGY, rothConversion: { ...DEFAULT_WITHDRAWAL_STRATEGY.rothConversion! } },
  };
}

// --- Initialisation: load from storage or migrate from legacy keys ---

function initFromStorage(): { scenarios: Scenario[]; activeId: string } {
  try {
    const raw = localStorage.getItem(SCENARIOS_KEY);
    const savedActiveId = localStorage.getItem(ACTIVE_ID_KEY);
    if (raw) {
      const scenarios = JSON.parse(raw) as Scenario[];
      if (scenarios.length > 0) {
        const activeId =
          savedActiveId && scenarios.some(s => s.id === savedActiveId)
            ? savedActiveId
            : scenarios[0].id;
        return { scenarios, activeId };
      }
    }
  } catch { /* fall through */ }

  // Migration: assemble a scenario from legacy individual keys
  try {
    const country = ((localStorage.getItem(LEGACY_COUNTRY_KEY) ?? 'US') as CountryCode);
    const defaults = createDefaultScenarioData(country);

    const tryParse = <T,>(key: string): T | null => {
      try {
        const v = localStorage.getItem(key);
        return v ? (JSON.parse(v) as T) : null;
      } catch { return null; }
    };

    const scenario: Scenario = {
      id: uuidv4(),
      name: 'My Plan',
      createdAt: Date.now(),
      country,
      accounts: tryParse<Account[]>(LEGACY_ACCOUNTS_KEY) ?? defaults.accounts,
      profile: tryParse<Profile>(LEGACY_PROFILE_KEY) ?? defaults.profile,
      assumptions: tryParse<Assumptions>(LEGACY_ASSUMPTIONS_KEY) ?? defaults.assumptions,
      incomeStreams: tryParse<IncomeStream[]>(LEGACY_INCOME_STREAMS_KEY) ?? defaults.incomeStreams,
      withdrawalStrategy: tryParse<WithdrawalStrategySettings>(LEGACY_WITHDRAWAL_STRATEGY_KEY) ?? defaults.withdrawalStrategy,
    };
    return { scenarios: [scenario], activeId: scenario.id };
  } catch { /* fall through */ }

  // Fresh start
  const data = createDefaultScenarioData('US');
  const scenario: Scenario = { id: uuidv4(), name: 'My Plan', createdAt: Date.now(), ...data };
  return { scenarios: [scenario], activeId: scenario.id };
}

// --- The hook ---

export function useScenarios() {
  const [state, setState] = useState(() => initFromStorage());
  const { scenarios, activeId } = state;

  // Keep localStorage in sync
  useEffect(() => {
    try {
      localStorage.setItem(SCENARIOS_KEY, JSON.stringify(scenarios));
      localStorage.setItem(ACTIVE_ID_KEY, activeId);
      const active = scenarios.find(s => s.id === activeId);
      if (active) localStorage.setItem(LEGACY_COUNTRY_KEY, active.country);
    } catch { /* ignore */ }
  }, [scenarios, activeId]);

  const activeScenario = scenarios.find(s => s.id === activeId) ?? scenarios[0];

  // Patch the active scenario's fields
  const patchActive = useCallback((patch: Partial<Scenario>) => {
    setState(prev => ({
      ...prev,
      scenarios: prev.scenarios.map(s =>
        s.id === prev.activeId ? { ...s, ...patch } : s
      ),
    }));
  }, []);

  // Per-field setters (support function updater form)
  const setAccounts = useCallback(
    (value: Account[] | ((prev: Account[]) => Account[])) =>
      patchActive({ accounts: typeof value === 'function' ? value(activeScenario.accounts) : value }),
    [patchActive, activeScenario.accounts]
  );

  const setProfile = useCallback(
    (value: Profile | ((prev: Profile) => Profile)) =>
      patchActive({ profile: typeof value === 'function' ? value(activeScenario.profile) : value }),
    [patchActive, activeScenario.profile]
  );

  const setAssumptions = useCallback(
    (value: Assumptions | ((prev: Assumptions) => Assumptions)) =>
      patchActive({ assumptions: typeof value === 'function' ? value(activeScenario.assumptions) : value }),
    [patchActive, activeScenario.assumptions]
  );

  const setIncomeStreams = useCallback(
    (value: IncomeStream[] | ((prev: IncomeStream[]) => IncomeStream[])) =>
      patchActive({ incomeStreams: typeof value === 'function' ? value(activeScenario.incomeStreams) : value }),
    [patchActive, activeScenario.incomeStreams]
  );

  const setWithdrawalStrategy = useCallback(
    (value: WithdrawalStrategySettings | ((prev: WithdrawalStrategySettings) => WithdrawalStrategySettings)) =>
      patchActive({ withdrawalStrategy: typeof value === 'function' ? value(activeScenario.withdrawalStrategy) : value }),
    [patchActive, activeScenario.withdrawalStrategy]
  );

  // Scenario management
  const loadScenario = useCallback((id: string) => {
    setState(prev =>
      prev.scenarios.some(s => s.id === id) ? { ...prev, activeId: id } : prev
    );
  }, []);

  const createScenario = useCallback(
    (name: string, data: Omit<Scenario, 'id' | 'name' | 'createdAt'>): Scenario => {
      const newScenario: Scenario = { id: uuidv4(), name, createdAt: Date.now(), ...data };
      setState(prev => ({ scenarios: [...prev.scenarios, newScenario], activeId: newScenario.id }));
      return newScenario;
    },
    []
  );

  const renameScenario = useCallback((id: string, name: string) => {
    setState(prev => ({
      ...prev,
      scenarios: prev.scenarios.map(s => (s.id === id ? { ...s, name } : s)),
    }));
  }, []);

  const deleteScenario = useCallback((id: string) => {
    setState(prev => {
      if (prev.scenarios.length <= 1) return prev;
      const remaining = prev.scenarios.filter(s => s.id !== id);
      const newActiveId = prev.activeId === id ? remaining[remaining.length - 1].id : prev.activeId;
      return { scenarios: remaining, activeId: newActiveId };
    });
  }, []);

  // Merge incoming scenarios: if an incoming ID already exists, replace in-place;
  // otherwise append. Call site sets IDs appropriately (existing ID = overwrite,
  // fresh UUID = add new).
  const importScenarios = useCallback((incoming: Scenario[]) => {
    if (incoming.length === 0) return;
    setState(prev => {
      const merged = [...prev.scenarios];
      for (const s of incoming) {
        const idx = merged.findIndex(e => e.id === s.id);
        if (idx >= 0) merged[idx] = s;
        else merged.push(s);
      }
      return { ...prev, scenarios: merged };
    });
  }, []);

  return {
    // Scenario list
    scenarios,
    activeId,
    activeScenario,
    // Active scenario's data (destructured for convenience)
    country: activeScenario.country,
    accounts: activeScenario.accounts,
    profile: activeScenario.profile,
    assumptions: activeScenario.assumptions,
    incomeStreams: activeScenario.incomeStreams,
    withdrawalStrategy: activeScenario.withdrawalStrategy,
    // Setters
    setAccounts,
    setProfile,
    setAssumptions,
    setIncomeStreams,
    setWithdrawalStrategy,
    patchActive,
    // Scenario management
    loadScenario,
    createScenario,
    renameScenario,
    deleteScenario,
    importScenarios,
  };
}
