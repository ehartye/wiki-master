# Documentation extraction fixtures

Reduced from official HTML retrieved on 2026-10-19:

- `three-buffer.html`: https://threejs.org/docs/pages/BufferAttribute.html — introduction and linked `needsUpdate` heading.
- `three-gltf.html`: https://threejs.org/docs/pages/GLTFLoader.html — introduction, first three supported extensions, Import section.
- `github-pages.html`: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site — availability statement and public-site warning.
- `sharp-install.html`: https://sharp.pixelplumbing.com/install/ — optional-dependency and cross-platform lockfile cautions.

The selected upstream elements retain their classes, attributes, text, and links. Minimal synthetic page shells and labelled navigation/footer text replace unrelated content. These reproduce losses in Defuddle 0.19.5 before Markdown conversion; tests run offline. They do not model sections absent from served HTML or prove completeness of arbitrary documentation.

Retrieved on 2026-10-20, `github-rest-artifacts.html` preserves the complete "Get an artifact" endpoint from https://docs.github.com/en/rest/actions/artifacts; `github-rest-workflow-runs.html` preserves "List workflow runs for a repository" from https://docs.github.com/en/rest/actions/workflow-runs. Both retain the original `.gutter` layout, parameter tables/captions, status tables, method/path block and supplied cURL/JSON examples. The rest of each page is replaced with the minimal shell. Defuddle's exact `.gutter` removal rule drops these endpoint bodies; they are present in the served HTML without browser rendering. Source text belongs to the respective upstream projects.
