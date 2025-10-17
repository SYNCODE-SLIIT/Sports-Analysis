import Image from "next/image";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type LeagueHeroInfo = {
  name: string;
  country?: string;
  leagueLogo?: string;
  countryLogo?: string;
  alternateNames?: string[];
  founded?: string;
  currentSeason?: string;
  website?: string;
  description?: string;
};

const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("");

type LeagueInfoHeroProps = {
  info: LeagueHeroInfo;
};

export function LeagueInfoHero({ info }: LeagueInfoHeroProps) {
  const {
    name,
    country,
    leagueLogo,
    countryLogo,
    alternateNames = [],
    founded,
    currentSeason,
    website,
    description,
  } = info;

  const summary =
    description && description.length > 360
      ? `${description.slice(0, 360).trimEnd()}…`
      : description;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="flex flex-col gap-6 p-6 md:flex-row md:items-stretch md:justify-between">
        <div className="flex flex-1 items-start gap-4">
          <div className="relative h-24 w-24 overflow-hidden rounded-xl border border-border/60 bg-muted/50 md:h-auto md:w-56 md:self-stretch">
            {leagueLogo ? (
              <Image src={leagueLogo} alt={name} fill sizes="(max-width: 768px) 96px, 224px" className="object-contain p-3" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-4xl font-semibold text-muted-foreground md:text-5xl">
                {initials(name)}
              </div>
            )}
          </div>
          <div className="flex-1 space-y-3 md:min-h-[160px]">
            <div>
              <h1 className="text-2xl font-semibold text-foreground md:text-3xl">{name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {country && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1">
                    {countryLogo ? (
                      <span className="relative h-5 w-5 overflow-hidden rounded-full border border-border/60">
                        <Image src={countryLogo} alt={`${country} flag`} fill sizes="20px" className="object-cover" />
                      </span>
                    ) : null}
                    <span>{country}</span>
                  </span>
                )}
                {founded && (
                  <Badge variant="outline" className="border-border/60 bg-background/80">
                    Founded {founded}
                  </Badge>
                )}
                {currentSeason && (
                  <Badge variant="secondary" className="bg-primary/10 text-primary">
                    {currentSeason}
                  </Badge>
                )}
              </div>
            </div>
            {alternateNames.length ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Also known as</span>
                {alternateNames.slice(0, 4).map(alias => (
                  <span key={alias} className="rounded-full border border-border/40 bg-muted/20 px-2 py-1">
                    {alias}
                  </span>
                ))}
              </div>
            ) : null}
            {summary ? <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{summary}</p> : null}
            {website ? (
              <Link
                href={website.startsWith("http") ? website : `https://${website}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                Official website
              </Link>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
