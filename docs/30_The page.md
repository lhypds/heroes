
The page
========


On the page each name is closed; press it and the applications unfold. A link
to one person, `#handle`, arrives with them open.  

The page reads in English, 中文, 日本語, Français, Español and Deutsch. The list
itself is written in English.  

It is drawn in GitHub's light, GitHub's dark, or black and white; the switch
is at the top of the page. Until a reader chooses, it is light or dark as
their system is.  


Languages
---------

The page's own words are in `src/i18n/<lang>.json`, one file per language:
`en`, `zh`, `ja`, `fr`, `es`, `de`. The page opens in the language the reader
chose last, or the browser's; `?lang=ja` in the address opens it in one
language for that visit.  

An entry is written in English. A description or a bio may instead be an object
keyed by those same codes, and the page shows the reader's language when it is
there, English otherwise.  


Themes
------

Every color is a name in `src/global.css`, filled in three ways: GitHub's
light, GitHub's dark, and black-and-white. GitHub's values are read off
github.com's own stylesheets, token for token. The theme is the reader's
choice, remembered like the language; until they choose, the page is light
or dark as their system is, and follows it.  
