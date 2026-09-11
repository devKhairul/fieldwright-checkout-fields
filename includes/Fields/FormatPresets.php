<?php
/**
 * Text-field format presets.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Fields;

defined( 'ABSPATH' ) || exit;

/**
 * Single source of truth for format presets. Patterns are written to be valid
 * both as an HTML `pattern` attribute (compiled by browsers with the `v` flag)
 * and inside a PCRE `~^(?:…)$~u` wrapper on the server, so the two agree.
 */
final class FormatPresets {

	public const ANY     = 'any';
	public const EMAIL   = 'email';
	public const PHONE   = 'phone';
	public const NUMBER  = 'number';
	public const URL     = 'url';
	public const LETTERS = 'letters';
	public const CUSTOM  = 'custom';

	/**
	 * Prefix of the transient that records "this pattern blew up at checkout".
	 * The rest of the name is an md5 of the pattern, so the flag follows the
	 * pattern rather than the field, and a merchant who edits the pattern gets a
	 * clean slate.
	 */
	public const ERROR_TRANSIENT_PREFIX = 'cbwb_pattern_error_';

	/**
	 * How long a recorded pattern error keeps warning the merchant.
	 */
	public const ERROR_TRANSIENT_TTL = HOUR_IN_SECONDS;

	/**
	 * Preset definitions.
	 *
	 * @return array<string, array{label: string, pattern: string|null, message: string}>
	 */
	public static function all(): array {
		return array(
			self::ANY     => array(
				'label'   => __( 'Any text', 'fieldwright-checkout-fields' ),
				'pattern' => null,
				'message' => '',
			),
			self::EMAIL   => array(
				'label'   => __( 'Email address', 'fieldwright-checkout-fields' ),
				'pattern' => '[^\s@]+@[^\s@]+\.[^\s@]{2,}',
				'message' => __( 'Please enter a valid email address.', 'fieldwright-checkout-fields' ),
			),
			self::PHONE   => array(
				'label'   => __( 'Phone number', 'fieldwright-checkout-fields' ),
				'pattern' => '\+?[0-9 ().\/-]{6,25}',
				'message' => __( 'Please enter a valid phone number.', 'fieldwright-checkout-fields' ),
			),
			self::NUMBER  => array(
				'label'   => __( 'Number', 'fieldwright-checkout-fields' ),
				'pattern' => '-?[0-9]+([.,][0-9]+)?',
				'message' => __( 'Please enter a number.', 'fieldwright-checkout-fields' ),
			),
			self::URL     => array(
				'label'   => __( 'Web address', 'fieldwright-checkout-fields' ),
				'pattern' => 'https?:\/\/[^\s]+',
				'message' => __( 'Please enter a valid web address (starting with http:// or https://).', 'fieldwright-checkout-fields' ),
			),
			self::LETTERS => array(
				'label'   => __( 'Letters only', 'fieldwright-checkout-fields' ),
				'pattern' => "[\p{L} '.\-]+",
				'message' => __( 'Please use letters only.', 'fieldwright-checkout-fields' ),
			),
			self::CUSTOM  => array(
				'label'   => __( 'Custom pattern', 'fieldwright-checkout-fields' ),
				'pattern' => null,
				'message' => __( 'Please match the requested format.', 'fieldwright-checkout-fields' ),
			),
		);
	}

	/**
	 * Preset keys.
	 *
	 * @return string[]
	 */
	public static function keys(): array {
		return array_keys( self::all() );
	}

	/**
	 * Whether a preset key exists.
	 *
	 * @param string $key Preset key.
	 * @return bool
	 */
	public static function exists( string $key ): bool {
		return isset( self::all()[ $key ] );
	}

	/**
	 * Resolve the effective pattern for a field (preset or custom).
	 *
	 * @param string      $preset  Preset key.
	 * @param string|null $custom  Custom pattern when preset is "custom".
	 * @return string|null Pattern without anchors/delimiters, or null for none.
	 */
	public static function pattern_for( string $preset, ?string $custom ): ?string {
		if ( self::CUSTOM === $preset ) {
			return ( null === $custom || '' === $custom ) ? null : $custom;
		}
		return self::all()[ $preset ]['pattern'] ?? null;
	}

	/**
	 * Longest pattern body a merchant may save.
	 */
	public const MAX_PATTERN_LENGTH = 500;

	/**
	 * Whether a pattern is usable everywhere it will be evaluated.
	 *
	 * A saved pattern is run by two engines, and it has to satisfy both. On the
	 * server it is PCRE. In the shopper's browser it is whatever ajv compiles
	 * WooCommerce's `validation` schema into, which is `new RegExp( pattern, 'u' )`
	 * — inside a React render, with no try/catch around it. A pattern PCRE
	 * accepts and ECMAScript does not therefore does not merely go unenforced:
	 * it throws during the checkout's render and replaces the form with an error
	 * for every shopper. Both checks run before a pattern can be stored.
	 *
	 * @param string $pattern Pattern body.
	 * @return bool
	 */
	public static function is_valid_pattern( string $pattern ): bool {
		return self::compiles_as_pcre( $pattern ) && self::is_ecmascript_pattern( $pattern );
	}

	/**
	 * Whether a pattern compiles as PCRE with our wrapper.
	 *
	 * @param string $pattern Pattern body.
	 * @return bool
	 */
	public static function compiles_as_pcre( string $pattern ): bool {
		if ( '' === $pattern || strlen( $pattern ) > self::MAX_PATTERN_LENGTH ) {
			return false;
		}
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Probing pattern validity.
		return false !== @preg_match( self::wrap( $pattern ), '' );
	}

	/**
	 * Whether a pattern is also valid ECMAScript regular expression syntax under
	 * the `u` flag.
	 *
	 * PHP has no ECMAScript engine to ask, so the pattern is read by hand. The
	 * reading is deliberately conservative: it accepts the constructs both
	 * engines share and refuses everything it is not sure about, because the cost
	 * of a wrong "yes" is a checkout nobody can complete, while the cost of a
	 * wrong "no" is a merchant rewording one pattern at the moment they type it.
	 *
	 * What it refuses, and why each one matters:
	 *
	 * - Escapes outside ECMAScript's set. PCRE reads an unknown escape such as
	 *   `\-`, `\_` or `\%` as the character itself; under `u` every one of them
	 *   is a SyntaxError. This single rule is what catches `\A`, `\Z`, `\z`,
	 *   `\G`, `\h`, `\H`, `\K`, `\R`, `\X`, `\Q`, `\E` and the `v`-only `\q{…}`.
	 * - Group prefixes other than `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!` and a named
	 *   group, which rules out `(?#comment)`, inline flags like `(?i)`, atomic
	 *   groups `(?>…)` and PCRE's `(?P<name>…)` spelling. Lookbehind and named
	 *   groups are ECMAScript too, so both are allowed.
	 * - Possessive quantifiers (`a++`, `a*+`, `a?+`, `a{2}+`), which under `u`
	 *   read as a quantifier applied to a quantifier: nothing to repeat.
	 * - POSIX classes (`[[:alpha:]]`), which ECMAScript has no notion of.
	 * - `\p`/`\P` without braces, and a range whose end is a class escape
	 *   (`[\d-z]`, and so the `v`-only `[\p{L}--[aeiou]]`).
	 * - A brace or bracket that is not part of a quantifier or a class. Outside
	 *   `u` mode both engines read a stray `{` or `]` as a literal; under `u`
	 *   they are errors, which is how the rest of the `v`-only syntax
	 *   (`[[a-z]&&[^aeiou]]`) is caught.
	 *
	 * @param string $pattern Pattern body.
	 * @return bool
	 */
	public static function is_ecmascript_pattern( string $pattern ): bool {
		$length = strlen( $pattern );
		if ( 0 === $length || $length > self::MAX_PATTERN_LENGTH ) {
			return false;
		}

		$groups = self::capturing_groups( $pattern );
		$names  = self::group_names( $pattern );
		$index  = 0;

		// One entry per open group, saying whether a quantifier may follow its
		// closing bracket. A lookahead or lookbehind is an assertion rather than
		// an atom, so `(?=a)+` is a SyntaxError under `u` where PCRE allows it.
		$stack = array();

		// Whether a quantifier here would have an atom to repeat, and whether the
		// token just read was itself a quantifier. ECMAScript needs the first and
		// forbids the second; PCRE allows both, and reads the second as a
		// possessive quantifier.
		$atom       = false;
		$quantified = false;

		while ( $index < $length ) {
			$char = $pattern[ $index ];

			if ( '[' === $char ) {
				$index = self::scan_class( $pattern, $index );
				if ( -1 === $index ) {
					return false;
				}
				$atom       = true;
				$quantified = false;
				continue;
			}

			if ( ']' === $char || '}' === $char ) {
				return false;
			}

			if ( '(' === $char ) {
				$quantifiable = false;
				$index        = self::scan_group_open( $pattern, $index, $quantifiable );
				if ( -1 === $index ) {
					return false;
				}
				$stack[]    = $quantifiable;
				$atom       = false;
				$quantified = false;
				continue;
			}

			if ( ')' === $char ) {
				if ( array() === $stack ) {
					return false;
				}
				++$index;
				$atom       = (bool) array_pop( $stack );
				$quantified = false;
				continue;
			}

			if ( '|' === $char || '^' === $char || '$' === $char ) {
				++$index;
				$atom       = false;
				$quantified = false;
				continue;
			}

			if ( '*' === $char || '+' === $char || '?' === $char || '{' === $char ) {
				$next = self::scan_quantifier( $pattern, $index );
				if ( -1 === $next || ! $atom || $quantified ) {
					return false;
				}
				$index      = $next;
				$atom       = false;
				$quantified = true;
				continue;
			}

			if ( '\\' === $char ) {
				$next = self::scan_escape( $pattern, $index, false, $groups, $names );
				if ( -1 === $next ) {
					return false;
				}
				// `\b` and `\B` are assertions, not atoms, so nothing may repeat them.
				$escaped    = $pattern[ $index + 1 ];
				$atom       = 'b' !== $escaped && 'B' !== $escaped;
				$quantified = false;
				$index      = $next;
				continue;
			}

			++$index;
			$atom       = true;
			$quantified = false;
		}//end while

		return array() === $stack;
	}

	/**
	 * Test a value against a pattern body.
	 *
	 * `preg_match()` answers false for two situations that deserve opposite
	 * treatment, and telling them apart is the whole point of this method:
	 *
	 * - The pattern never compiled. There is no constraint to enforce and the
	 *   merchant cannot have meant to reject everything, so the value passes —
	 *   a regex typo must not lock every customer out of checkout.
	 * - The pattern compiled and then failed while running: the backtrack or
	 *   recursion limit, or invalid UTF-8. That is a failure a *shopper* can
	 *   provoke by choosing their input, so treating it as a match would make
	 *   every format rule bypassable. It fails closed, and leaves a flag behind
	 *   for the builder screen to warn the merchant with.
	 *
	 * The two are separated by re-compiling rather than by `preg_last_error()`,
	 * which before PHP 8.0 is not set at all when compilation fails.
	 *
	 * @param string $pattern Pattern body.
	 * @param string $value   Value.
	 * @return bool
	 */
	public static function matches( string $pattern, string $value ): bool {
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- A broken custom pattern must not block checkout.
		$result = @preg_match( self::wrap( $pattern ), $value );

		if ( false !== $result ) {
			return 1 === $result;
		}

		if ( ! self::compiles_as_pcre( $pattern ) ) {
			return true;
		}

		self::record_error( $pattern );

		return false;
	}

	/**
	 * How many capturing groups a pattern opens.
	 *
	 * Only needed to judge a numbered backreference: under `u` a `\1` with no
	 * first group is a SyntaxError, where PCRE reads it as an octal escape.
	 *
	 * @param string $pattern Pattern body.
	 * @return int
	 */
	private static function capturing_groups( string $pattern ): int {
		$length   = strlen( $pattern );
		$count    = 0;
		$in_class = false;

		for ( $index = 0; $index < $length; $index++ ) {
			$char = $pattern[ $index ];

			if ( '\\' === $char ) {
				++$index;
				continue;
			}

			if ( $in_class ) {
				if ( ']' === $char ) {
					$in_class = false;
				}
				continue;
			}

			if ( '[' === $char ) {
				$in_class = true;
				continue;
			}

			if ( '(' !== $char ) {
				continue;
			}

			$after = $pattern[ $index + 1 ] ?? '';

			// `(` on its own opens a capturing group; so does `(?<name>`, which is
			// told apart from the two lookbehinds by what follows the angle bracket.
			if ( '?' !== $after ) {
				++$count;
			} elseif ( '<' === ( $pattern[ $index + 2 ] ?? '' ) && ! in_array( $pattern[ $index + 3 ] ?? '', array( '=', '!' ), true ) ) {
				++$count;
			}
		}//end for

		return $count;
	}

	/**
	 * The names the pattern gives its groups.
	 *
	 * Under `u` a `\k<name>` that names no group is a SyntaxError, where PCRE
	 * would only fail at match time, so the names have to be known before the
	 * body is read.
	 *
	 * @param string $pattern Pattern body.
	 * @return string[]
	 */
	private static function group_names( string $pattern ): array {
		preg_match_all( '/\(\?<([A-Za-z_$][A-Za-z0-9_$]*)>/', $pattern, $matches );

		return $matches[1];
	}

	/**
	 * Read one group opening, and answer where its contents start.
	 *
	 * @param string $pattern      Pattern body.
	 * @param int    $index        Offset of the `(`.
	 * @param bool   $quantifiable Set to whether a quantifier may follow the group's close.
	 * @return int Offset after the opening, or -1 when ECMAScript has no such group.
	 */
	private static function scan_group_open( string $pattern, int $index, bool &$quantifiable ): int {
		$rest         = substr( $pattern, $index );
		$quantifiable = true;

		if ( '?' !== ( $pattern[ $index + 1 ] ?? '' ) ) {
			return $index + 1;
		}

		foreach ( array( '(?<=', '(?<!', '(?=', '(?!' ) as $prefix ) {
			if ( 0 === strpos( $rest, $prefix ) ) {
				$quantifiable = false;
				return $index + strlen( $prefix );
			}
		}

		if ( 0 === strpos( $rest, '(?:' ) ) {
			return $index + 3;
		}

		if ( 1 === preg_match( '/^\(\?<[A-Za-z_$][A-Za-z0-9_$]*>/', $rest, $matches ) ) {
			return $index + strlen( $matches[0] );
		}

		return -1;
	}

	/**
	 * Read one quantifier, including a trailing `?` that makes it lazy.
	 *
	 * @param string $pattern Pattern body.
	 * @param int    $index   Offset of the quantifier's first character.
	 * @return int Offset after the quantifier, or -1 when it is not one.
	 */
	private static function scan_quantifier( string $pattern, int $index ): int {
		$char = $pattern[ $index ];
		$end  = $index + 1;

		if ( '{' === $char ) {
			// A brace that does not spell out a count is a literal to PCRE and an
			// error to ECMAScript, so `{,3}` and a stray `{` are both refused here.
			if ( 1 !== preg_match( '/^\{[0-9]+(,[0-9]*)?\}/', substr( $pattern, $index ), $matches ) ) {
				return -1;
			}
			$end = $index + strlen( $matches[0] );
		}

		if ( '?' === ( $pattern[ $end ] ?? '' ) ) {
			++$end;
		}

		return $end;
	}

	/**
	 * Read one backslash escape.
	 *
	 * @param string   $pattern  Pattern body.
	 * @param int      $index    Offset of the backslash.
	 * @param bool     $in_class Whether the escape sits inside a character class.
	 * @param int      $groups   How many capturing groups the pattern opens.
	 * @param string[] $names    Names of the pattern's named groups.
	 * @return int Offset after the escape, or -1 when ECMAScript rejects it.
	 */
	private static function scan_escape( string $pattern, int $index, bool $in_class, int $groups, array $names = array() ): int {
		$next = $index + 1;
		if ( $next >= strlen( $pattern ) ) {
			return -1;
		}

		$char = $pattern[ $next ];
		$rest = substr( $pattern, $next + 1 );

		// A SyntaxCharacter may always be escaped. `-` may be, but only where it
		// would otherwise open a range.
		if ( false !== strpos( '^$\\.*+?()[]{}|/', $char ) ) {
			return $next + 1;
		}
		if ( '-' === $char ) {
			return $in_class ? $next + 1 : -1;
		}

		// `\b` is a word boundary outside a class and a backspace inside one;
		// `\B` only exists outside.
		if ( 'b' === $char ) {
			return $next + 1;
		}
		if ( 'B' === $char ) {
			return $in_class ? -1 : $next + 1;
		}

		if ( false !== strpos( 'dDsSwWfnrtv', $char ) ) {
			return $next + 1;
		}

		// `\0` is the null character, but `\01` is a legacy octal escape that only
		// PCRE reads.
		if ( '0' === $char ) {
			return 1 === preg_match( '/^[0-9]/', $rest ) ? -1 : $next + 1;
		}

		if ( 'c' === $char ) {
			return 1 === preg_match( '/^[A-Za-z]/', $rest ) ? $next + 2 : -1;
		}

		if ( 'x' === $char ) {
			return 1 === preg_match( '/^[0-9A-Fa-f]{2}/', $rest ) ? $next + 3 : -1;
		}

		if ( 'u' === $char ) {
			if ( 1 === preg_match( '/^\{[0-9A-Fa-f]{1,6}\}/', $rest, $matches ) ) {
				return $next + 1 + strlen( $matches[0] );
			}
			return 1 === preg_match( '/^[0-9A-Fa-f]{4}/', $rest ) ? $next + 5 : -1;
		}

		if ( 'p' === $char || 'P' === $char ) {
			if ( 1 === preg_match( '/^\{[A-Za-z0-9_]+(=[A-Za-z0-9_]+)?\}/', $rest, $matches ) ) {
				return $next + 1 + strlen( $matches[0] );
			}
			return -1;
		}

		// A named backreference, valid only when the pattern names that group.
		if ( 'k' === $char && ! $in_class ) {
			if ( 1 === preg_match( '/^<([A-Za-z_$][A-Za-z0-9_$]*)>/', $rest, $matches ) && in_array( $matches[1], $names, true ) ) {
				return $next + 1 + strlen( $matches[0] );
			}
			return -1;
		}

		if ( ! $in_class && $char >= '1' && $char <= '9' ) {
			preg_match( '/^[0-9]+/', substr( $pattern, $next ), $matches );
			return (int) $matches[0] <= $groups ? $next + strlen( $matches[0] ) : -1;
		}

		return -1;
	}

	/**
	 * Read one character class, and answer where it ends.
	 *
	 * @param string $pattern Pattern body.
	 * @param int    $index   Offset of the opening `[`.
	 * @return int Offset after the closing `]`, or -1 when the class is not ECMAScript.
	 */
	private static function scan_class( string $pattern, int $index ): int {
		$length = strlen( $pattern );
		$cursor = $index + 1;

		if ( '^' === ( $pattern[ $cursor ] ?? '' ) ) {
			++$cursor;
		}

		// A range may not be bounded by `\d`, `\p{…}` and the like. Tracking the
		// two together is what refuses `[\d-z]`, `[a-\d]` and, with them, the
		// `v`-only set difference `[\p{L}--[aeiou]]`.
		$class_escape = false;
		$open_range   = false;

		while ( $cursor < $length ) {
			$char = $pattern[ $cursor ];

			if ( ']' === $char ) {
				return $cursor + 1;
			}

			if ( '[' === $char && ':' === ( $pattern[ $cursor + 1 ] ?? '' ) ) {
				return -1;
			}

			if ( '\\' === $char ) {
				$escaped = $pattern[ $cursor + 1 ] ?? '';
				$next    = self::scan_escape( $pattern, $cursor, true, 0 );
				if ( -1 === $next ) {
					return -1;
				}
				$is_class_escape = false !== strpos( 'dDsSwWpP', $escaped );
				if ( $open_range && $is_class_escape ) {
					return -1;
				}
				$class_escape = $is_class_escape;
				$open_range   = false;
				$cursor       = $next;
				continue;
			}

			if ( '-' === $char ) {
				$following = $pattern[ $cursor + 1 ] ?? '';

				// A `-` last in the class, or with nothing after it, is a literal.
				if ( ']' === $following || '' === $following ) {
					$class_escape = false;
					$open_range   = false;
					++$cursor;
					continue;
				}

				if ( $class_escape ) {
					return -1;
				}

				$open_range = true;
				++$cursor;
				continue;
			}

			$class_escape = false;
			$open_range   = false;
			++$cursor;
		}//end while

		return -1;
	}

	/**
	 * Name of the transient flagging a pattern that failed at runtime.
	 *
	 * @param string $pattern Pattern body.
	 * @return string
	 */
	public static function error_transient( string $pattern ): string {
		return self::ERROR_TRANSIENT_PREFIX . md5( $pattern );
	}

	/**
	 * Whether a pattern has failed at runtime recently enough to still be worth
	 * telling the merchant about.
	 *
	 * @param string $pattern Pattern body.
	 * @return bool
	 */
	public static function had_error( string $pattern ): bool {
		return false !== get_transient( self::error_transient( $pattern ) );
	}

	/**
	 * Flag a pattern that compiled and then failed while matching.
	 *
	 * Written from the checkout, so it is deliberately cheap and self-limiting:
	 * one row per distinct pattern per hour, no matter how many shoppers trip
	 * over it, and no error_log noise on a store whose debug log is shipped
	 * somewhere.
	 *
	 * @param string $pattern Pattern body.
	 */
	private static function record_error( string $pattern ): void {
		$key = self::error_transient( $pattern );

		if ( false !== get_transient( $key ) ) {
			return;
		}

		set_transient( $key, $pattern, self::ERROR_TRANSIENT_TTL );
	}

	/**
	 * Wrap a pattern body for PCRE, anchored and unicode-aware.
	 *
	 * The delimiter is chosen rather than escaped around. Escaping it is what an
	 * earlier version did, and it mishandled a pattern that already contained an
	 * escaped delimiter: `\~` became `\\~`, whose backslash is now a literal, so
	 * the `~` after it closed the pattern early and the merchant was told their
	 * valid pattern was not a regular expression. Picking a character the pattern
	 * does not use at all has no such edge, and cannot let a pattern add flags of
	 * its own either.
	 *
	 * @param string $pattern Pattern body.
	 * @return string
	 */
	private static function wrap( string $pattern ): string {
		$pattern = self::pcre_code_points( $pattern );

		foreach ( array( '~', '#', '%', '!', '@', ';', "\x01" ) as $delimiter ) {
			if ( false === strpos( $pattern, $delimiter ) ) {
				return $delimiter . '^(?:' . $pattern . ')$' . $delimiter . 'u';
			}
		}

		// Every candidate appears in the pattern, which takes a deliberate effort.
		// Fall back to escaping, and accept that such a pattern may not compile.
		return '~^(?:' . str_replace( '~', '\~', $pattern ) . ')$~u';
	}

	/**
	 * Spell ECMAScript code point escapes the way PCRE spells them.
	 *
	 * A pattern is written once and run by two engines, and the two do not agree
	 * on how a code point is written: JavaScript reads `é` and `\u{e9}`,
	 * PCRE reads `\x{e9}`. What PCRE makes of `\u` depends on the build behind
	 * the PHP in use. Some refuse the pattern outright, others read it under
	 * their own rules, and neither outcome is the browser's. Rewriting the escape
	 * here, before anything is compiled, is what makes the server match exactly
	 * the characters the browser matches. Only the two ECMAScript forms are
	 * touched, and only where the backslash is really an escape: `\\u0041` is a
	 * backslash followed by the letters, in both engines, and stays as it is.
	 *
	 * The lexer in `is_ecmascript_pattern()` has already refused any `\u` that is
	 * not followed by four hex digits or a braced group of one to six, so by the
	 * time a pattern reaches this method the two forms are the only ones left.
	 *
	 * @param string $pattern Pattern body in ECMAScript spelling.
	 * @return string The same pattern in PCRE spelling.
	 */
	private static function pcre_code_points( string $pattern ): string {
		if ( false === strpos( $pattern, '\\u' ) ) {
			return $pattern;
		}

		$out    = '';
		$length = strlen( $pattern );
		$index  = 0;

		while ( $index < $length ) {
			$char = $pattern[ $index ];

			if ( '\\' !== $char ) {
				$out .= $char;
				++$index;
				continue;
			}

			$rest = substr( $pattern, $index + 1 );

			if ( 1 === preg_match( '/^u\{([0-9A-Fa-f]{1,6})\}/', $rest, $matches ) ) {
				$out   .= '\\x{' . $matches[1] . '}';
				$index += 1 + strlen( $matches[0] );
				continue;
			}

			if ( 1 === preg_match( '/^u([0-9A-Fa-f]{4})/', $rest, $matches ) ) {
				$out   .= '\\x{' . $matches[1] . '}';
				$index += 1 + strlen( $matches[0] );
				continue;
			}

			// Any other escape is carried over whole, so the character after the
			// backslash is never read as the start of something else.
			$out   .= substr( $pattern, $index, 2 );
			$index += 2;
		}//end while

		return $out;
	}
}
