// melee classes (glaive, polearm, heavy blade...) aren't in the weapon export, so this is the wiki's class categories
// (Category:Glaive, Category:Polearm... Nov 2026), used to rank a weapon against its own kind. a melee weapon that isn't
// listed (Vinquibus' melee side, new ones) just ranks against all melee
export const MELEE_CLASSES: Record<string, string[]> = {
  'Blade and Whip': ['Ceti Lacera', 'Dorrclave', 'Jat Kusar', 'Lacera', 'Mios'],
  'Claws': ['Garuda Prime Talons', 'Garuda Talons', 'Keratinos', 'Ripkas', 'Valkyr Talons', 'Venka', 'Venka Prime'],
  'Dagger': ['Ceramic Dagger', 'Dark Dagger', 'Heat Dagger', 'Innodem', 'Karyst', 'Karyst Prime', 'Rakta Dark Dagger', 'Rumblejack', 'Sheev'],
  'Dual Daggers': ['Ether Daggers', 'Fang', 'Fang Prime', 'Nepheri', 'Okina', 'Okina Prime'],
  'Dual Nikanas': ['Sun & Moon'],
  'Dual Swords': ['Dark Split-Sword', 'Dex Dakra', 'Dual Cleavers', 'Dual Ether', 'Dual Heat Swords', 'Dual Ichor', 'Dual Kamas', 'Dual Kamas Prime', 'Dual Keres', 'Dual Keres Prime', 'Dual Raza', 'Dual Skana', 'Dual Viciss', 'Dual Zoren', 'Dual Zoren Prime', 'Nami Skyla', 'Nami Skyla Prime', 'Prisma Dual Cleavers', 'Twin Basolk', 'Twin Krohkur'],
  'Fist': ['Ankyros', 'Ankyros Prime', 'Furax', 'Furax Wraith', 'Mk1-Furax', 'Ruvox', 'Tekko', 'Tekko Prime'],
  'Glaive': ['Cerata', 'Coda Pathocyst', 'Falcor', 'Glaive', 'Glaive Prime', 'Halikar', 'Halikar Wraith', 'Kestrel', 'Kestrel Prime', 'Orvius', 'Pathocyst', 'Xoris'],
  'Gunblade': ['Redeemer', 'Redeemer Prime', 'Sarpa', 'Stropha', 'Vastilok'],
  'Hammer': ['Arca Titron', 'Coda Motovore', 'Ekhein', 'Fragor', 'Fragor Prime', 'Heliocor', 'Jat Kittag', 'Kuva Shildeg', 'Magistar', 'Sampotes', 'Sancti Magistar', 'Sibear', 'Synoid Heliocor', 'Volnus', 'Volnus Prime', 'Wolf Sledge'],
  'Heavy Blade': ['Galatine', 'Galatine Prime', 'Gram', 'Gram Prime', 'Masseter', 'Masseter Prime', 'Paracesis', 'Sarofang', 'Sarofang Prime', 'Scindo', 'Scindo Prime', 'Tenet Exec', 'Vitrica', 'War', 'War Prime', 'Zenistar'],
  'Heavy Scythe': ['Corufell', 'Corufell Prime', 'Hespar', 'Pride', 'Thalys', 'Wrath'],
  'Machete': ['Gazal Machete', 'Kama', 'Kreska', 'Machete', 'Machete Wraith', 'Nami Solo', 'Prisma Machete', 'Prova', 'Prova Vandal', 'Slaytra'],
  'Nikana': ['Dex Nikana', 'Dragon Nikana', 'Nikana', 'Nikana Prime', 'Skiajati', 'Syam'],
  'Nunchaku': ['Ninkondi', 'Ninkondi Prime', 'Pulmonars', 'Shaku'],
  'Polearm': ['Amanata', 'Cassowar', 'Edun', 'Guandao', 'Guandao Prime', 'Kesheg', 'Korumm', 'Lesion', 'Orthos', 'Orthos Prime', 'Pupacyst', 'Serro', 'Sydon', 'Tonbo', 'Vaykor Sydon'],
  'Rapier': ['Destreza', 'Destreza Prime', 'Endura'],
  'Scythe': ['Anku', 'Caustacyst', 'Coda Caustacyst', 'Ether Reaper', 'Galariak Prime', 'Harmony', 'Hate', 'Reaper Prime', 'Tenet Grigori', 'Venato', 'Venato Prime'],
  'Sparring': ['Coda Hirudo', 'Hirudo', 'Kogake', 'Kogake Prime', 'Korrudo', 'Obex', 'Prisma Obex'],
  'Staff': ['Amphis', 'Bo', 'Bo Prime', 'Broken Scepter', 'Cadus', 'Mk1-Bo', 'Tipedo', 'Tipedo Prime'],
  'Sword': ['Broken War', 'Coda Mire', 'Cronus', 'Dakra Prime', 'Dark Sword', 'Ether Sword', 'Heat Sword', 'Jaw Sword', 'Krohkur', 'Mire', 'Pangolin Prime', 'Pangolin Sword', 'Plasma Sword', 'Prisma Skana', 'Skana', 'Skana Prime'],
  'Sword and Shield': ['Ack & Brunt', 'Argo & Vel', 'Cobra & Crane', 'Cobra & Crane Prime', 'Sigma & Octantis', 'Silva & Aegis', 'Silva & Aegis Prime', 'Tak & Lug', 'Tenet Agendus'],
  'Tonfa': ['Boltace', 'Kronen', 'Kronen Prime', 'Ohma', 'Praedos', 'Prisma Ohma', 'Telos Boltace', 'Tonkkatt'],
  'Two-Handed Nikana': ['Azothane', 'Pennant', 'Tatsu', 'Tatsu Prime', 'Tenet Livia'],
  'Warfan': ['Arum Spinosa', 'Gunsen', 'Gunsen Prime', 'Quassus', 'Quassus Prime', 'Vericres'],
  'Whip': ['Atterax', 'Galvacord', 'Lecta', 'Scoliac', 'Secura Lecta', 'Spinnerex', 'Verdilac'],
  'Assault Saw': ['Ghoulsaw', 'Kuva Ghoulsaw'],
}

// spearguns are filed as Rifle in the data (wiki Category:Speargun)
export const SPEARGUNS = ['Afentis', 'Afentis Prime', 'Ferrox', 'Javlok', 'Scourge', 'Scourge Prime', 'Tenet Ferrox']

const meleeClassByName = new Map(Object.entries(MELEE_CLASSES).flatMap(([cls, names]) => names.map((name) => [name, cls] as const)))
export const meleeClassOf = (name: string) => meleeClassByName.get(name) ?? null
