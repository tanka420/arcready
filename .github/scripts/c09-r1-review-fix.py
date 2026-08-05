import json
from pathlib import Path


DOC = Path("docs/research/C09-R1.md")
METADATA = Path("/tmp/c09-parser-pack.json")


def replace_once(old: str, new: str, label: str) -> None:
    text = DOC.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    DOC.write_text(text.replace(old, new, 1), encoding="utf-8")


pack_data = json.loads(METADATA.read_text(encoding="utf-8"))
if not isinstance(pack_data, list) or len(pack_data) != 1:
    raise SystemExit("npm pack metadata must contain exactly one package")

package = pack_data[0]
packed_size = package.get("size")
unpacked_size = package.get("unpackedSize")
files = package.get("files")

if not isinstance(packed_size, int) or packed_size <= 0:
    raise SystemExit("npm pack metadata is missing a positive packed size")
if not isinstance(unpacked_size, int) or unpacked_size <= 0:
    raise SystemExit("npm pack metadata is missing a positive unpacked size")
if not isinstance(files, list) or not files:
    raise SystemExit("npm pack metadata is missing published files")

replace_once(
    """- latest observed release: `0.20.2`, published 2025-07-21;
- supports AST traversal and optional source locations;
- used by established Solidity tooling.
""",
    f"""- latest observed release: `0.20.2`, published 2025-07-21;
- npm registry metadata reports zero runtime dependencies;
- `npm pack --dry-run --json` measured a packed artifact of
  `{packed_size}` bytes, an unpacked artifact of `{unpacked_size}` bytes, and
  `{len(files)}` published files on 2026-08-05;
- supports AST traversal and optional source locations;
- used by established Solidity tooling.
""",
    "parser package measurements",
)

replace_once(
    """- transitive dependency, package-size, and supply-chain cost must be measured
  before any production proposal.
""",
    """- the package has no runtime dependencies, but its generated grammar bundle,
  published artifact size, maintainer surface, and supply-chain cost still require
  a production dependency review;
- registry measurements must be repeated when R3 begins because published package
  contents can change between versions.
""",
    "parser package risk wording",
)

replace_once(
    """R3-B should compare at most one adapter from each of these framework families:

- a Foundry broadcast or deployment artifact that records chain ID and exact
  contract identity;
- a Hardhat deployment artifact or manifest that records network identity and
  exact contract identity.

R3-B must not implement a generic deployment-discovery framework.
""",
    """R2 may compare ownership evidence shapes from both framework families, but
R3-B must select exactly one framework-specific adapter total for the first
experiment:

- a Foundry broadcast or deployment artifact that records chain ID and exact
  contract identity; or
- a Hardhat deployment artifact or manifest that records network identity and
  exact contract identity.

The first R3-B experiment must not implement both adapters. R3-B must not
implement a generic deployment-discovery framework.
""",
    "single R3-B adapter boundary",
)
