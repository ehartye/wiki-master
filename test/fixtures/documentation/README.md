# Documentation extraction fixtures

Reduced from official HTML retrieved on 2026-10-19:

- `three-buffer.html`: https://threejs.org/docs/pages/BufferAttribute.html — introduction and linked `needsUpdate` heading.
- `three-gltf.html`: https://threejs.org/docs/pages/GLTFLoader.html — introduction, first three supported extensions, Import section.
- `github-pages.html`: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site — availability statement and public-site warning.
- `sharp-install.html`: https://sharp.pixelplumbing.com/install/ — optional-dependency and cross-platform lockfile cautions.

The selected upstream elements retain their classes, attributes, text, and links. Minimal synthetic page shells and labelled navigation/footer text replace unrelated content. These reproduce losses in Defuddle 0.19.5 before Markdown conversion; tests run offline. They do not model sections absent from served HTML or prove completeness of arbitrary documentation.

Retrieved on 2026-10-20, `github-rest-artifacts.html` preserves the complete "Get an artifact" endpoint from https://docs.github.com/en/rest/actions/artifacts; `github-rest-workflow-runs.html` preserves "List workflow runs for a repository" from https://docs.github.com/en/rest/actions/workflow-runs. Both retain the original `.gutter` layout, parameter tables/captions, status tables, method/path block and supplied cURL/JSON examples. The rest of each page is replaced with the minimal shell. Defuddle's exact `.gutter` removal rule drops these endpoint bodies; they are present in the served HTML without browser rendering. Source text belongs to the respective upstream projects.

## Line endings

The fixtures are stored with LF line endings. The repository's `.gitattributes` pins `test/fixtures/**` to LF (`text=auto eol=lf`), so a fresh checkout or a `git archive` export keeps them LF even when `core.autocrlf=true`. Without that rule a Windows checkout with `core.autocrlf=true` converts them to CRLF, and so does a `git archive` export made with that setting, because the export follows `core.autocrlf`. A checkout made before the rule existed keeps CRLF fixtures until its files are checked out again (`git rm --cached -r . && git reset --hard`, with no uncommitted work).

`test/rest-reference.test.mjs` compares an exact multiline cURL or JSON example from the fixture text with the extracted Markdown. A CRLF fixture makes that comparison fail with `missing exact example`, although the extractor returns byte-identical Markdown, title and fidelity warnings for LF and CRLF input. The test therefore reads the fixtures as LF and has a separate case that extracts both forms and compares them. Either the attribute or the reader normalization alone is enough to make the two example cases pass; removing the normalization from the reader while the fixtures are CRLF turns exactly those two cases red and leaves the other three green.

The rule is `text=auto`, not `text`: a forced `text` strips the carriage returns out of a binary fixture that contains CRLF when it is added, and `text=auto` leaves such a file alone. To check a checkout, run `git ls-files --eol test/fixtures`; every text fixture should read `i/lf w/lf`.
