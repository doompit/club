# The Swamp Club — doomps.xyz home

Static site for doomps.xyz on Cloudflare Pages: home, the Portal, and
DOOMP Lore. This is the public hub ("The Swamp Club") that links out to the
Doompify app hosted at club.doomps.xyz.

## Pages

    index.html    Home         → /
    portal.html   The Portal   → /portal
    lore.html     DOOMP Lore   → /lore

## App links (club.doomps.xyz)

The nav and footer link to the Doompify app:

    Verify          → https://club.doomps.xyz/
    The Swamp chat  → https://club.doomps.xyz/chat
    Memematic 3000  → https://club.doomps.xyz/memematic
    Gallery         → https://club.doomps.xyz/gallery

NOTE: the old sweep.doomps.xyz service has been fully removed.

## Deploying

Replace your existing index.html, portal.html, and lore.html on Cloudflare
Pages with these versions.

## club.doomps.xyz routing (important)

These clean paths (/chat, /memematic, /gallery) require the Doompify app to
serve them. The app currently ships pages as chat.html and swamp.html
(#gallery / #memematic). To make the clean paths work, add redirects/rewrites
on the club.doomps.xyz deployment (e.g. Cloudflare Pages _redirects):

    /chat        /chat.html            200
    /memematic   /swamp.html           200
    /gallery     /swamp.html           200

(For /memematic and /gallery you may also want the app to scroll to the right
section; the swamp page uses #memematic and #gallery anchors.)
