const GpoNames = {
  key(name) { return String(name || '').trim().toLowerCase(); },
  legacy(name) { return String(name || '').replace(/[^a-zA-Z0-9\s\-_.,=@]/g, '').trim(); },
  resolve(name, gpos, managedNames = [name]) {
    const exact = gpos.filter(g => this.key(g.DisplayName) === this.key(name));
    if (exact.length) return exact.length === 1 ? exact[0] : null;
    const legacy = this.key(this.legacy(name));
    if (!legacy) return null;
    const owners = new Set(managedNames.filter(n => this.key(this.legacy(n)) === legacy).map(n => this.key(n)));
    if (owners.size > 1) return null;
    const matches = gpos.filter(g => this.key(g.DisplayName) === legacy);
    return matches.length === 1 ? matches[0] : null;
  }
};
if (typeof module !== 'undefined') module.exports = GpoNames;
