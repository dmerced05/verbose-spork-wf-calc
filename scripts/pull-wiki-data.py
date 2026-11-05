# pulls the wiki's data modules (Module:Weapons/data/*, Module:Enemies/data/*) and saves the parts the calc checks against,
# as plain JSON next to this script. the modules are plain Lua tables, so I run them with lupa instead of regexing them.
# run with: python3 scripts/pull-wiki-data.py   (needs: pip install lupa)
import json, sys, urllib.request
from datetime import date
from pathlib import Path
from lupa import LuaRuntime

HERE = Path(__file__).parent
WIKI = 'https://wiki.warframe.com/w/Module:{}?action=raw'
lua = LuaRuntime(unpack_returned_tuples=True)


def fetch(module):
    request = urllib.request.Request(WIKI.format(module), headers={'User-Agent': 'wf-calc data check'})
    return urllib.request.urlopen(request, timeout=60).read().decode()


def to_py(value):
    # Lua tables come back as either lists (1..n keys) or dicts. math.huge (a fire rate of "instant") isn't JSON, so None
    if lupa_type(value) != 'table':
        return None if isinstance(value, float) and value in (float('inf'), float('-inf')) else value
    keys = list(value.keys())
    if keys and all(isinstance(key, int) for key in keys) and sorted(keys) == list(range(1, len(keys) + 1)):
        return [to_py(value[key]) for key in sorted(keys)]
    return {str(key): to_py(value[key]) for key in keys}


lupa_type = lambda value: 'table' if hasattr(value, 'keys') and callable(value.keys) else 'other'

# weapons: per attack the base numbers, plus the weapon's built-in mods (DefaultUpgrades, Cernos Prime has one)
weapons = {}
for slot in ['primary', 'secondary', 'melee']:
    table = to_py(lua.execute(fetch(f'Weapons/data/{slot}')))
    for name, weapon in table.items():
        attacks = []
        for attack in weapon.get('Attacks', []) or []:
            attacks.append({
                'name': attack.get('AttackName'),
                'damage': {key.lower(): number for key, number in (attack.get('Damage') or {}).items()},
                'critChance': attack.get('CritChance'), 'critMultiplier': attack.get('CritMultiplier'),
                'statusChance': attack.get('StatusChance'), 'fireRate': attack.get('FireRate'), 'multishot': attack.get('Multishot'),
                # Kuva Chakkhurr / Cernos Prime 0.5, Synapse 0.2: "+50% bonus damage on headshots is additive to other sources of +bonus damage
                # on headshot such as Primary Deadhead" (wiki Kuva Chakkhurr). -2 (Alternox, Arca Plasmor, Nataruk's Perfect Shot): no headshot multiplier
                'extraHeadshot': attack.get('ExtraHeadshotDmg'),
            })
        weapons[name] = {'internalName': weapon.get('InternalName'), 'defaultUpgrades': weapon.get('DefaultUpgrades') or [], 'attacks': attacks}

# enemies: base health/shield/armor/level, faction and head multiplier, by internal name (names repeat across factions)
FACTIONS = ['grineer', 'corpus', 'infestation', 'orokin', 'sentient', 'stalker', 'narmer', 'themurmur', 'techrot', 'scaldra', 'anarchs', 'unaffiliated']
enemies = {}
for faction in FACTIONS:
    table = to_py(lua.execute(fetch(f'Enemies/data/{faction}')))
    for name, enemy in table.items():
        general, stats = enemy.get('General', {}) or {}, enemy.get('Stats', {}) or {}
        key = general.get('InternalName') or f'wiki:{name}'
        head = next((multi for multi in stats.get('Multis', []) or [] if str(multi).lower().startswith('head')), None)
        enemies[key] = {
            'name': general.get('Name', name), 'faction': general.get('Faction'), 'health': stats.get('Health'), 'shield': stats.get('Shield'),
            'armor': stats.get('Armor'), 'overguard': stats.get('Overguard'), 'baseLevel': stats.get('BaseLevel'),
            'headMultiplier': float(head.split(':')[1].strip().rstrip('x')) if head and ':' in head and head.split(':')[1].strip().rstrip('x').replace('.', '', 1).isdigit() else None,
        }

stamp = f'wiki.warframe.com Module:Weapons/data and Module:Enemies/data, pulled {date.today()} by scripts/pull-wiki-data.py'
(HERE / 'wiki-weapons.json').write_text(json.dumps({'_source': stamp, 'weapons': weapons}, separators=(',', ':')))
(HERE / 'wiki-enemies.json').write_text(json.dumps({'_source': stamp, 'enemies': enemies}, separators=(',', ':')))
print(f'{len(weapons)} weapons, {len(enemies)} enemies', file=sys.stderr)
