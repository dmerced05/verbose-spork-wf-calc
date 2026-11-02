// one dropdown per evolution tier, shared by Compare Weapons and the Rivens page. starts on the leaderboard's picks,
// conditional parts stay off
import type { IncarnonTier } from '../calc/incarnon'
import type { Picks } from '../calc/evolved'

interface Props {
  tiers: IncarnonTier[] | null
  picks: Picks
  fromLeaderboard: boolean
  onChange: (picks: Picks) => void
}

export function EvolutionPicker({ tiers, picks, fromLeaderboard, onChange }: Props) {
  if (!tiers) return null
  return (
    <div className="cw-evos">
      <span className="muted-inline">Evolutions{fromLeaderboard ? ' (leaderboard\'s picks)' : ''}:</span>
      {tiers.map(({ tier, perks }) => (
        <select key={tier} value={picks[tier] ?? ''} onChange={(event) => {
          const next = { ...picks }
          if (event.target.value) next[tier] = event.target.value
          else delete next[tier]
          onChange(next)
        }}>
          <option value="">{tier}: none</option>
          {perks.map((perk) => <option key={perk.name} value={perk.name}>{tier}: {perk.name}</option>)}
        </select>
      ))}
    </div>
  )
}
