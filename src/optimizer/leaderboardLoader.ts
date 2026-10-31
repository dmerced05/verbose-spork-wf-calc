// the leaderboard JSON, fetched once per page load and only when a tab needs it (Compare, Compare Weapons)
import { expandLeaderboard, type Leaderboard, type LeaderboardFile } from './leaderboardTypes'

let leaderboardPromise: Promise<Leaderboard | null> | null = null
export const loadLeaderboard = () =>
  (leaderboardPromise ??= fetch('./leaderboard.json')
    .then((response) => (response.ok ? (response.json() as Promise<LeaderboardFile>) : null))
    .then((file) => (file ? expandLeaderboard(file) : null))
    .catch(() => null))
