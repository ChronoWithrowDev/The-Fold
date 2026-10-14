import { useState, useRef } from 'react';
import { Icon } from './Icons';
import { CHAPTERS, type SaveData } from '../game/types';
import {
  listWorlds,
  saveWorld,
  deleteWorld,
  downloadWorldFile,
  importWorldJson,
  createNewWorldProfile,
  getActiveWorldId,
  setActiveWorldId,
  type WorldProfile,
} from '../game/worlds';

interface Props {
  onLoadWorld: (world: WorldProfile) => void;
  onSaveCurrentWorld?: (name?: string) => void;
  currentSaveData?: SaveData | null;
  isInGame: boolean;
  onClose: () => void;
}

export function WorldSaveModal({
  onLoadWorld,
  onSaveCurrentWorld,
  currentSaveData,
  isInGame,
  onClose,
}: Props) {
  const [worlds, setWorlds] = useState<WorldProfile[]>(() => listWorlds());
  const [activeId, setActiveIdState] = useState<string | null>(() => getActiveWorldId());
  const [newWorldName, setNewWorldName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshWorlds = () => {
    const updated = listWorlds();
    setWorlds(updated);
    setActiveIdState(getActiveWorldId());
  };

  const handleCreateNew = () => {
    if (!newWorldName.trim()) return;
    const profile = createNewWorldProfile(newWorldName.trim(), isInGame ? currentSaveData : null);
    refreshWorlds();
    setNewWorldName('');
    setIsCreating(false);
    onLoadWorld(profile);
  };

  const handleSaveToExisting = (world: WorldProfile) => {
    if (!currentSaveData) return;
    saveWorld({
      ...world,
      data: {
        ...currentSaveData,
        savedAt: Date.now(),
      },
    });
    setActiveWorldId(world.id);
    if (onSaveCurrentWorld) onSaveCurrentWorld(world.name);
    refreshWorlds();
  };

  const handleDelete = (id: string) => {
    deleteWorld(id);
    setConfirmDeleteId(null);
    refreshWorlds();
  };

  const handleRename = (world: WorldProfile) => {
    if (!editName.trim()) {
      setEditingId(null);
      return;
    }
    saveWorld({
      ...world,
      name: editName.trim(),
    });
    setEditingId(null);
    refreshWorlds();
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result;
      if (typeof content !== 'string') return;
      const imported = importWorldJson(content);
      if (imported) {
        setImportError(null);
        refreshWorlds();
        onLoadWorld(imported);
      } else {
        setImportError('Invalid world save file format.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m ${Math.floor(seconds % 60)}s`;
  };

  return (
    <>
      <div className="dialog-heading">
        <span className="eyebrow">WORLD ARCHIVES & SAVED EXPEDITIONS</span>
        <h2>Manage your worlds.</h2>
        <p>Save multiple states, load alternate dimensions, or export your discoveries.</p>
      </div>

      <div className="world-save-actions-bar">
        <button
          className="subtle-button"
          onClick={() => setIsCreating(true)}
          style={{ borderColor: 'rgba(165,229,204,0.5)', color: '#d8faea' }}
        >
          <Icon name="save" size={15} />
          {isInGame ? 'Save As New World' : 'Create New World'}
        </button>

        <button
          className="subtle-button"
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon name="upload" size={15} />
          Import World (.json)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleFileImport}
        />

        {importError && <span className="world-import-error">{importError}</span>}
      </div>

      {isCreating && (
        <div className="world-create-form">
          <input
            type="text"
            className="world-name-input"
            placeholder="Enter world name (e.g. Mountain Expedition)..."
            value={newWorldName}
            onChange={e => setNewWorldName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreateNew();
              if (e.key === 'Escape') setIsCreating(false);
            }}
            autoFocus
          />
          <button className="primary-button" style={{ minHeight: '38px', padding: '0 16px' }} onClick={handleCreateNew}>
            Confirm & Save
          </button>
          <button className="text-button" onClick={() => setIsCreating(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="worlds-grid-container">
        {worlds.length === 0 ? (
          <div className="worlds-empty-state">
            <p>No saved worlds found.</p>
            <button className="primary-button" onClick={() => setIsCreating(true)}>
              Start Your First Saved World
            </button>
          </div>
        ) : (
          worlds.map(world => {
            const stageIndex = Math.min(world.data.stage, CHAPTERS.length - 1);
            const chapter = CHAPTERS[stageIndex];
            const isFinished = world.data.stage >= CHAPTERS.length;
            const isActive = world.id === activeId;

            return (
              <div key={world.id} className={`world-card ${isActive ? 'active-world' : ''}`}>
                <div className="world-card-header">
                  {editingId === world.id ? (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%' }}>
                      <input
                        className="world-name-input-small"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRename(world);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                      />
                      <button className="text-button" onClick={() => handleRename(world)}>
                        Save
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h3 className="world-title" onDoubleClick={() => { setEditingId(world.id); setEditName(world.name); }}>
                        {world.name}
                      </h3>
                      <button
                        className="icon-button"
                        style={{ width: '22px', height: '22px', opacity: 0.6 }}
                        onClick={() => { setEditingId(world.id); setEditName(world.name); }}
                        title="Rename world"
                      >
                        ✎
                      </button>
                    </div>
                  )}
                  {isActive && <span className="world-badge-current">ACTIVE</span>}
                </div>

                <div className="world-card-body">
                  <span className="eyebrow" style={{ color: '#a2cfb7' }}>
                    {isFinished ? 'REALITY RESTORED' : `${String(world.data.stage + 1).padStart(2, '0')} / ${chapter.place}`}
                  </span>
                  <div className="world-chapter-name">
                    {isFinished ? 'Walsenburg Complete' : chapter.name}
                  </div>
                  <div className="world-stats-row">
                    <span>⏱ {formatTime(world.data.playtime)}</span>
                    <span>📍 Stage {world.data.stage + 1}/{CHAPTERS.length}</span>
                    <span>📅 {new Date(world.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="world-card-actions">
                  <button
                    className="primary-button world-action-btn"
                    style={{ minHeight: '34px', padding: '0 14px', fontSize: '11px' }}
                    onClick={() => {
                      setActiveWorldId(world.id);
                      onLoadWorld(world);
                      onClose();
                    }}
                  >
                    <Icon name="play" size={13} />
                    Load World
                  </button>

                  {isInGame && (
                    <button
                      className="subtle-button world-action-btn"
                      style={{ minHeight: '34px', padding: '0 12px', fontSize: '10px' }}
                      onClick={() => handleSaveToExisting(world)}
                      title="Overwrite this slot with current in-game progress"
                    >
                      <Icon name="save" size={13} />
                      Overwrite
                    </button>
                  )}

                  <button
                    className="icon-button"
                    style={{ width: '34px', height: '34px' }}
                    onClick={() => downloadWorldFile(world)}
                    title="Export / Download save file (.json)"
                  >
                    <Icon name="download" size={16} />
                  </button>

                  {confirmDeleteId === world.id ? (
                    <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                      <button
                        className="subtle-button"
                        style={{ color: '#ff8a8a', borderColor: '#ff8a8a', minHeight: '30px', padding: '0 8px' }}
                        onClick={() => handleDelete(world.id)}
                      >
                        Delete?
                      </button>
                      <button className="text-button" style={{ fontSize: '10px' }} onClick={() => setConfirmDeleteId(null)}>
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      className="icon-button"
                      style={{ width: '34px', height: '34px', color: '#b97a7a' }}
                      onClick={() => setConfirmDeleteId(world.id)}
                      title="Delete world"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="dialog-footer">
        <span>
          <Icon name="check" size={14} />
          {worlds.length} saved world{worlds.length === 1 ? '' : 's'} stored on this computer
        </span>
        <button className="text-button" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
