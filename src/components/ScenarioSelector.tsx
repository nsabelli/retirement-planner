import { useState, useRef, useEffect } from 'react';
import type { Scenario } from '../types';
import type { CountryCode } from '../countries';

interface ScenarioSelectorProps {
  scenarios: Scenario[];
  activeId: string;
  onLoad: (id: string) => void;
  onCreateFromDefaults: (name: string, country: CountryCode) => void;
  onCreateFromCurrent: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function ScenarioSelector({
  scenarios,
  activeId,
  onLoad,
  onCreateFromDefaults,
  onCreateFromCurrent,
  onRename,
  onDelete,
}: ScenarioSelectorProps) {
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [newName, setNewName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const createPanelRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const newNameInputRef = useRef<HTMLInputElement>(null);

  const activeScenario = scenarios.find(s => s.id === activeId) ?? scenarios[0];

  // Close create panel when clicking outside
  useEffect(() => {
    if (!showCreatePanel) return;
    function handleClick(e: MouseEvent) {
      if (createPanelRef.current && !createPanelRef.current.contains(e.target as Node)) {
        setShowCreatePanel(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCreatePanel]);

  // Focus inputs when panels open
  useEffect(() => {
    if (showCreatePanel) newNameInputRef.current?.focus();
  }, [showCreatePanel]);

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    if (id !== activeId) onLoad(id);
  }

  function startRename() {
    setRenameValue(activeScenario.name);
    setIsRenaming(true);
    setShowCreatePanel(false);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== activeScenario.name) {
      onRename(activeScenario.id, trimmed);
    }
    setIsRenaming(false);
  }

  function handleRenameKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setIsRenaming(false);
  }

  function handleCreateFromDefaults() {
    const name = newName.trim() || `Scenario ${scenarios.length + 1}`;
    onCreateFromDefaults(name, activeScenario.country);
    setNewName('');
    setShowCreatePanel(false);
  }

  function handleCreateFromCurrent() {
    const name = newName.trim() || `${activeScenario.name} (copy)`;
    onCreateFromCurrent(name);
    setNewName('');
    setShowCreatePanel(false);
  }

  function handleCreateKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setShowCreatePanel(false);
      setNewName('');
    }
  }

  function confirmDelete() {
    onDelete(activeScenario.id);
    setShowDeleteConfirm(false);
  }

  const canDelete = scenarios.length > 1;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
        Scenario:
      </label>

      {/* Scenario select */}
      {isRenaming ? (
        <div className="flex items-center gap-1">
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKey}
            className="px-2 py-1.5 text-sm border border-blue-400 dark:border-blue-500 rounded-md
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                       focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
            aria-label="Rename scenario"
          />
          <button
            onClick={commitRename}
            className="p-1 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300"
            title="Confirm rename"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            onClick={() => setIsRenaming(false)}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title="Cancel"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <select
          value={activeId}
          onChange={handleSelectChange}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                     focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                     cursor-pointer max-w-[180px]"
          aria-label="Select scenario"
        >
          {scenarios.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}

      {/* Rename */}
      {!isRenaming && (
        <button
          onClick={startRename}
          className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400
                     hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          title="Rename scenario"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      )}

      {/* New scenario — button + inline panel */}
      <div className="relative" ref={createPanelRef}>
        <button
          onClick={() => { setShowCreatePanel(v => !v); setIsRenaming(false); }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium
                     text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600
                     hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors"
          title="Create new scenario"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New
        </button>

        {showCreatePanel && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800
                          border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 w-64">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">New scenario name</p>
            <input
              ref={newNameInputRef}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={handleCreateKey}
              placeholder={`Scenario ${scenarios.length + 1}`}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                         focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={handleCreateFromCurrent}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600
                           hover:bg-blue-700 rounded-md transition-colors text-left"
              >
                Copy current scenario
                <span className="block text-xs font-normal text-blue-200 mt-0.5">
                  Start with your current data
                </span>
              </button>
              <button
                onClick={handleCreateFromDefaults}
                className="w-full px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300
                           bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600
                           rounded-md transition-colors text-left"
              >
                Start from defaults
                <span className="block text-xs font-normal text-gray-500 dark:text-gray-400 mt-0.5">
                  Fresh scenario with example data
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete */}
      {showDeleteConfirm ? (
        <div className="flex items-center gap-1 text-sm">
          <span className="text-red-600 dark:text-red-400 text-xs">Delete "{activeScenario.name}"?</span>
          <button
            onClick={confirmDelete}
            className="px-2 py-0.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded"
          >
            Yes
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400
                       bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => canDelete && setShowDeleteConfirm(true)}
          disabled={!canDelete}
          className={`p-1.5 rounded transition-colors ${
            canDelete
              ? 'text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
          }`}
          title={canDelete ? 'Delete scenario' : 'Cannot delete the only scenario'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}
