//! Human-readable names for rendered clips.
//!
//! Clips used to be written as `clip-03_flat.mp4`, which is useless once the
//! files leave the app. Names are now built from the project name, the clip
//! rank and the hook line, then sanitized so they stay valid on Linux, macOS
//! and Windows (no reserved characters, no trailing dots or spaces).

/// Longest hook fragment kept in a file name. Enough to be descriptive while
/// staying well below the 255-byte limit of common file systems.
const MAX_HOOK_LEN: usize = 60;

/// Replace Latin-1 accented characters with their ASCII base so Portuguese
/// and Spanish titles keep their words instead of collapsing to separators.
fn deaccent(ch: char) -> Option<char> {
    const TABLE: &[(char, &str)] = &[
        ('a', "áàâãäå"),
        ('e', "éèêë"),
        ('i', "íìîï"),
        ('o', "óòôõö"),
        ('u', "úùûü"),
        ('c', "ç"),
        ('n', "ñ"),
        ('y', "ýÿ"),
        ('s', "śš"),
        ('z', "źž"),
    ];

    let lowered = ch.to_lowercase().next().unwrap_or(ch);
    for (base, accented) in TABLE {
        if accented.contains(lowered) {
            return Some(if ch.is_uppercase() {
                base.to_ascii_uppercase()
            } else {
                *base
            });
        }
    }
    None
}

/// Turn arbitrary text into a filesystem-safe slug.
///
/// Keeps `a-z`, `A-Z`, `0-9` and `_`; every other character collapses into a
/// single `-`. Returns an empty string when nothing usable is left.
pub fn slugify(input: &str, max_len: usize) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_sep = false;

    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            out.push(ch);
            last_was_sep = false;
            continue;
        }

        match deaccent(ch) {
            Some(mapped) => {
                out.push(mapped);
                last_was_sep = false;
            }
            None => {
                if !last_was_sep && !out.is_empty() {
                    out.push('-');
                    last_was_sep = true;
                }
            }
        }
    }

    let trimmed = out.trim_matches('-').to_string();
    if trimmed.chars().count() <= max_len {
        return trimmed;
    }

    // Cut on a word boundary when possible so names stay readable.
    let cut: String = trimmed.chars().take(max_len).collect();
    let boundary = cut.rsplit_once('-').map(|(head, _)| head.to_string());
    match boundary {
        Some(head) if head.chars().count() >= max_len / 2 => head.trim_matches('-').to_string(),
        _ => cut.trim_matches('-').to_string(),
    }
}

/// Format a position inside the source video as `2m03s`.
pub fn timecode(seconds: f64) -> String {
    let total = if seconds.is_finite() && seconds > 0.0 {
        seconds.round() as u64
    } else {
        0
    };
    format!("{}m{:02}s", total / 60, total % 60)
}

/// Build the file name for a clip: `<project>_<rank>_<hook>.mp4`.
///
/// Falls back to the clip time range when the hook has no usable characters,
/// so two clips of the same project never collide by accident.
pub fn clip_file_name(
    project_slug: &str,
    rank: i64,
    hook: &str,
    start_sec: f64,
    end_sec: f64,
) -> String {
    let project = slugify(project_slug, 40);
    let project = if project.is_empty() {
        "clip".to_string()
    } else {
        project
    };

    let hook_slug = slugify(hook, MAX_HOOK_LEN);
    let suffix = if hook_slug.is_empty() {
        format!("{}-{}", timecode(start_sec), timecode(end_sec))
    } else {
        hook_slug
    };

    format!("{project}_{:02}_{suffix}.mp4", rank.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_keeps_alphanumerics_and_separators() {
        assert_eq!(slugify("My Video - Final!", 60), "My-Video-Final");
        assert_eq!(slugify("episode_01", 60), "episode_01");
    }

    #[test]
    fn slugify_collapses_repeated_separators() {
        assert_eq!(slugify("a   ///   b", 60), "a-b");
    }

    #[test]
    fn slugify_transliterates_accents() {
        assert_eq!(slugify("Não é possível", 60), "Nao-e-possivel");
        assert_eq!(slugify("AÇÃO Çedilha", 60), "ACAO-Cedilha");
    }

    #[test]
    fn slugify_returns_empty_for_symbol_only_input() {
        assert_eq!(slugify("!!! ???", 60), "");
        assert_eq!(slugify("", 60), "");
    }

    #[test]
    fn slugify_truncates_on_word_boundary() {
        let long = "this is a very long hook that keeps going and going";
        let slug = slugify(long, 20);
        assert!(slug.chars().count() <= 20, "{slug}");
        assert!(!slug.ends_with('-'), "{slug}");
    }

    #[test]
    fn timecode_formats_minutes_and_seconds() {
        assert_eq!(timecode(0.0), "0m00s");
        assert_eq!(timecode(123.4), "2m03s");
        assert_eq!(timecode(f64::NAN), "0m00s");
    }

    #[test]
    fn clip_file_name_uses_project_rank_and_hook() {
        let name = clip_file_name("My Video", 3, "Nobody talks about this!", 12.0, 45.0);
        assert_eq!(name, "My-Video_03_Nobody-talks-about-this.mp4");
    }

    #[test]
    fn clip_file_name_falls_back_to_time_range() {
        let name = clip_file_name("proj", 1, "!!!", 12.0, 45.0);
        assert_eq!(name, "proj_01_0m12s-0m45s.mp4");
    }

    #[test]
    fn clip_file_name_survives_empty_project_slug() {
        let name = clip_file_name("", 2, "hook", 0.0, 30.0);
        assert_eq!(name, "clip_02_hook.mp4");
    }
}
