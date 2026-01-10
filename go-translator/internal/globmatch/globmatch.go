package globmatch

import (
	"regexp"
	"strings"
	"sync"
)

var reCache sync.Map // pattern -> *regexp.Regexp

func normalize(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	p = strings.TrimPrefix(p, "./")
	return p
}

func isRegexMeta(b byte) bool {
	switch b {
	case '.', '+', '^', '$', '(', ')', '|', '[', ']', '{', '}', '\\':
		return true
	default:
		return false
	}
}

func globToRegex(pattern string) string {
	p := normalize(pattern)

	suffixOptional := false
	if strings.HasSuffix(p, "/**") {
		suffixOptional = true
		p = strings.TrimSuffix(p, "/**")
	}

	var b strings.Builder
	b.WriteString("^")

	for i := 0; i < len(p); {
		ch := p[i]
		if ch == '*' {
			// ** or *
			if i+1 < len(p) && p[i+1] == '*' {
				i += 2
				// **/ -> zero or more directories (including none)
				if i < len(p) && p[i] == '/' {
					i++
					b.WriteString("(?:.*/)?")
				} else {
					b.WriteString(".*")
				}
				continue
			}
			b.WriteString("[^/]*")
			i++
			continue
		}
		if ch == '?' {
			b.WriteString("[^/]")
			i++
			continue
		}

		if isRegexMeta(ch) {
			b.WriteByte('\\')
		}
		b.WriteByte(ch)
		i++
	}

	if suffixOptional {
		b.WriteString("(?:/.*)?")
	}

	b.WriteString("$")
	return b.String()
}

func compile(pattern string) (*regexp.Regexp, error) {
	if v, ok := reCache.Load(pattern); ok {
		return v.(*regexp.Regexp), nil
	}
	re, err := regexp.Compile(globToRegex(pattern))
	if err != nil {
		return nil, err
	}
	reCache.Store(pattern, re)
	return re, nil
}

// Match reports whether relPath matches the glob pattern.
// The matcher supports:
// - "*" and "?"
// - "**" (including "**/" semantics)
// - patterns ending with "/**" also match the directory itself
//
// Both pattern and relPath are normalized to forward slashes.
func Match(pattern string, relPath string) bool {
	pat := strings.TrimSpace(pattern)
	if pat == "" {
		return false
	}
	path := normalize(relPath)

	re, err := compile(pat)
	if err != nil {
		return false
	}
	return re.MatchString(path)
}
