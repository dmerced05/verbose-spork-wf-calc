import { FACTIONS, factionLabel, hasHeadcrits, headMultiplierFor } from '../calc/constants'
import { STEEL_PATH_LEVEL_BONUS, scaleArmor, scaleHealth, scaleShield } from '../calc/target'
import { enemies, enemiesById } from '../data'
import type { Enemy, StatusMode, TargetLayer, TargetSettings } from '../types'
import { SearchSelect } from './SearchSelect'

// the export calls them "Infestation", the U36 table calls them "Infested"
const PRESET_FACTION: Record<string, string> = { Infestation: 'Infested' }
const enemyOptions = enemies.map((enemy) => ({ id: enemy.uniqueName, label: `${enemy.name} (${enemy.faction})` }))
const MAX_SLIDER_LEVEL = 400

export interface ScaledEnemy {
  enemy: Enemy
  effectiveLevel: number
  health: number
  shield: number
  armor: number // before debuffs
}

// level-scaled stats for the picked preset, Steel Path adds 100 levels and x2.5 health/shields
export function resolveEnemy(target: TargetSettings): ScaledEnemy | null {
  const enemy = target.enemyId ? enemiesById.get(target.enemyId) : undefined
  if (!enemy) return null
  const effectiveLevel = target.level + (target.steelPath ? STEEL_PATH_LEVEL_BONUS : 0)
  const levelsAboveBase = effectiveLevel - target.baseLevel
  return {
    enemy,
    effectiveLevel,
    health: scaleHealth(enemy.health, levelsAboveBase, target.faction, target.steelPath),
    shield: scaleShield(enemy.shield, levelsAboveBase, target.faction, target.steelPath),
    armor: scaleArmor(enemy.armor, levelsAboveBase),
  }
}

// picking a faction puts head multiplier + headcrit back on auto (they follow the faction in the calc)
const AUTO_HEAD = { headshotMultiplier: null, headcrit: null }

export const resolveArmor = (target: TargetSettings): number => resolveEnemy(target)?.armor ?? target.manualArmor

// one-click endgame targets. Steel Path adds 100 levels, so the level field is 100 under what they spawn at.
// Heavy Gunner: armor (500 base, past the 2,700 clamp at the cap). Techrot Babau: health (10,000 at level 1, wiki). Juggernaut:
// armor + status immune on its armored body (wiki: "immune to all status effects that hit its heavily armored outer body")
interface TargetPreset { label: string; title: string; target: Partial<TargetSettings> }
const presetsAt = (spawnLevel: number): TargetPreset[] => ([
  { label: `Heavy Gunner ${spawnLevel}`, title: 'Steel Path Heavy Gunner: armor check',
    target: { enemyId: '/Lotus/Types/Enemies/Grineer/AIWeek/Avatars/HeavyFemaleGrineerAvatar', faction: 'Grineer', baseLevel: 8, statusMode: 'normal' as StatusMode } },
  { label: `Babau ${spawnLevel}`, title: 'Steel Path Techrot Babau: health check (immune to Viral, not modeled)',
    target: { enemyId: 'wiki:TechrotBabau', faction: 'Techrot', baseLevel: 1, statusMode: 'normal' as StatusMode } },
  { label: `Juggernaut ${spawnLevel}`, title: 'Steel Path Juggernaut: armor, and status immune',
    target: { enemyId: '/Lotus/Types/Enemies/Infested/AiWeek/Quadrupeds/JuggernautAvatar', faction: 'Infested', baseLevel: 1, statusMode: 'immune' as StatusMode } },
] as TargetPreset[]).map((preset) => ({ ...preset, target: { ...preset.target, level: spawnLevel - STEEL_PATH_LEVEL_BONUS, steelPath: true, layer: 'health' as const, ...AUTO_HEAD } }))
const TARGET_PRESETS = [...presetsAt(9999), ...presetsAt(250)]

interface Props {
  target: TargetSettings
  onChange: (target: TargetSettings) => void
}

export function TargetPanel({ target, onChange }: Props) {
  const update = (changes: Partial<TargetSettings>) => onChange({ ...target, ...changes })
  const scaled = resolveEnemy(target)

  const pickEnemy = (enemyId: string | null) => {
    const picked = enemyId ? enemiesById.get(enemyId) : undefined
    const faction = picked ? PRESET_FACTION[picked.faction] ?? picked.faction : target.faction
    update({ enemyId, faction, ...AUTO_HEAD })
  }

  return (
    <section className="panel">
      <div className="row spread">
        <h2>Target</h2>
        <label className={`sp-toggle ${target.steelPath ? 'on' : ''}`}>
          <input type="checkbox" checked={target.steelPath} onChange={(event) => update({ steelPath: event.target.checked })} />
          Steel Path
        </label>
      </div>
      <div className="row target-presets">
        <span className="muted-inline">Steel Path presets:</span>
        {TARGET_PRESETS.map((preset) => (
          <button key={preset.label} title={preset.title} onClick={() => update(preset.target)}>{preset.label}</button>
        ))}
      </div>
      <div className="form-grid">
        <label>
          Enemy preset
          <SearchSelect options={enemyOptions} selectedId={target.enemyId} onSelect={pickEnemy} placeholder="None (manual armor)" />
        </label>
        <label>
          Faction
          <select value={target.faction} onChange={(event) => update({ faction: event.target.value, ...AUTO_HEAD })}>
            {FACTIONS.map((faction) => (
              <option key={faction} value={faction}>{factionLabel(faction)}</option>
            ))}
          </select>
        </label>
        <label>
          Hitting
          <select value={target.layer} onChange={(event) => update({ layer: event.target.value as TargetLayer })}>
            <option value="health">Health</option>
            <option value="shield">Shields</option>
            <option value="overguard">Overguard</option>
          </select>
        </label>
        <label title="Some enemies take no status at all, others hold at most 4 stacks of each status (DoTs and Viral etc. stop there)">
          Status effects
          <select value={target.statusMode ?? 'normal'} onChange={(event) => update({ statusMode: event.target.value as StatusMode })}>
            <option value="normal">Normal</option>
            <option value="capped">Capped at 4 stacks</option>
            <option value="immune">Immune</option>
          </select>
        </label>
        {scaled ? (
          <label>
            Base level
            <input type="number" min={1} value={target.baseLevel} onChange={(event) => update({ baseLevel: Math.max(1, Number(event.target.value)) })} />
          </label>
        ) : (
          <label>
            Armor
            <input type="number" min={0} value={target.manualArmor} onChange={(event) => update({ manualArmor: Number(event.target.value) })} />
          </label>
        )}
      </div>

      {scaled && (
        <div className="level-row">
          <label htmlFor="level-slider">Level</label>
          <input
            id="level-slider" type="range" min={1} max={MAX_SLIDER_LEVEL} value={Math.min(target.level, MAX_SLIDER_LEVEL)}
            onChange={(event) => update({ level: Number(event.target.value) })}
          />
          <input
            type="number" min={1} max={9999} value={target.level} className="level-input"
            onChange={(event) => update({ level: Math.max(1, Number(event.target.value)) })}
          />
          {target.steelPath && <span className="muted-inline">→ {scaled.effectiveLevel} on SP</span>}
        </div>
      )}

      <div className="form-grid headshot-grid">
        <label>
          Head multiplier{target.headshotMultiplier == null ? ' (auto)' : ''}
          <span className="row">
            <input
              type="number" min={1} step={0.5} value={target.headshotMultiplier ?? headMultiplierFor(target.faction)}
              onChange={(event) => update({ headshotMultiplier: Math.max(1, Number(event.target.value)) })}
            />
            {target.headshotMultiplier != null && <button onClick={() => update({ headshotMultiplier: null })}>Auto</button>}
          </span>
        </label>
        <label className="inline" title="Crit headshots double the weapon's base crit multiplier on enemies with headcrit heads">
          <input
            type="checkbox" checked={target.headcrit ?? hasHeadcrits(target.faction)}
            onChange={(event) => update({ headcrit: event.target.checked })}
          />
          Headcrits (×2 base crit mult){target.headcrit == null ? ' · auto' : ''}
          {target.headcrit != null && (
            <button className="link-button" onClick={(event) => { event.preventDefault(); update({ headcrit: null }) }}>reset</button>
          )}
        </label>
        <label className="inline">
          <input type="checkbox" checked={target.headshot} onChange={(event) => update({ headshot: event.target.checked })} />
          Main results assume headshots
        </label>
      </div>
      <p className="muted">
        {scaled
          ? 'Presets don\'t know where they spawn, so set the base level from the mission (or leave it at 1). Steel Path adds 100 levels and x2.5 health/shields, armor only scales with level.'
          : 'Pick a preset to get level-scaled health, shields and time to kill.'}
        {' '}Head multiplier and headcrits follow the faction: 3x on most, ~1.5x on Murmur/Techrot, no headcrits on most Corpus/Murmur/Techrot.
      </p>
    </section>
  )
}
