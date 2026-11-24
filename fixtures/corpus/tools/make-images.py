"""Images de référence du corpus : maquettes fil de fer abstraites (aucun texte,
aucune pièce réelle). Relancer : python3 fixtures/corpus/tools/make-images.py"""
import os, struct, zlib

W, H = 390, 720
ROOT = os.path.join(os.path.dirname(__file__), '..', 'e2e', 'tests')

def png(path, rects, bg=(246, 246, 244)):
    rows = []
    for y in range(H):
        row = bytearray()
        for x in range(W):
            c = bg
            for (x0, y0, x1, y1, col) in rects:
                if x0 <= x < x1 and y0 <= y < y1:
                    c = col
            row += bytes(c)
        rows.append(b'\x00' + bytes(row))
    raw = b''.join(rows)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)
    return data

INK, MID, LIGHT, ACCENT, WARN, ERR = (30, 34, 42), (150, 156, 166), (226, 228, 232), (42, 120, 214), (250, 178, 25), (208, 59, 59)

def screen(title_w, fields=0, button=ACCENT, extra=()):
    r = [(0, 0, W, 64, INK), (24, 96, 24 + title_w, 124, MID), (24, 136, 24 + title_w * 2 // 3, 150, LIGHT)]
    for i in range(fields):
        r.append((24, 190 + i * 70, W - 24, 236 + i * 70, LIGHT))
    r.append((24, H - 96, W - 24, H - 48, button))
    return r + list(extra)

S = {
    'welcome': screen(220, 0, extra=[(95, 200, 295, 400, LIGHT)]),
    'welcome-smoke': screen(220, 0, extra=[(95, 200, 295, 400, LIGHT), (24, 430, 200, 444, MID)]),
    'signature-online-fr': screen(260, 1, extra=[(24, 280, W - 24, 520, LIGHT), (24, 540, 44, 560, ACCENT)]),
    'signature-online-en': screen(240, 1, extra=[(24, 280, W - 24, 520, LIGHT), (24, 540, 44, 560, ACCENT)]),
    'summary': screen(180, 4),
    'signature-otp-helper-text-on-error': screen(250, 1, extra=[(24, 246, 250, 258, ERR)]),
    'journey-error': screen(200, 0, button=INK, extra=[(155, 220, 235, 300, ERR)]),
    'email-rej01': [(0, 0, W, 48, MID), (24, 80, 300, 104, INK), (24, 130, W - 24, 140, LIGHT), (24, 150, W - 60, 160, LIGHT), (24, 170, W - 90, 180, LIGHT)],
}
FILES = {
    'ui/pilot-account-opening/nominal.spec.ts-snapshots': ['welcome', 'signature-online-fr', 'signature-online-en', 'summary'],
    'ui/pilot-account-opening/signature-errors.spec.ts-snapshots': ['signature-otp-helper-text-on-error', 'journey-error'],
    'ui/shared/post-deployment.spec.ts-snapshots': ['welcome-smoke'],
    'workflow/pilot-account-opening/p1.spec.ts-snapshots': ['email-rej01'],
}
for d, names in FILES.items():
    for n in names:
        png(os.path.join(ROOT, d, f'{n}-chromium-darwin.png'), S[n])
# Doublon de rendu volontaire : la capture v2 de la pièce est identique au récapitulatif.
png(os.path.join(ROOT, 'ui/pilot-account-opening/scan-id.spec.ts-snapshots', 'id-capture-chromium-darwin.png'), S['summary'])
print('ok')
