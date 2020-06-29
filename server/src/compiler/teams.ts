import { MemberGroup, BaseMemberEntry, VariableTypes, ValueTypeObject, parseInitializerBlock } from './util';
import { Evaluator, Statement } from './parser';
import { TokenType, TokenIterator, Token } from './tokenizer';
import { colors } from './json_text';

type TeamCommandGetter = (e: Evaluator, team: string)=>string

const visibilityRules = ['always','hideForOwnTeam','hideForOtherTeams','never']
const collisionRules = ['always','pushOwnTeam','pushOtherTeams','never']

let _teamCommands: MemberGroup<BaseMemberEntry<TeamCommandGetter>,TeamCommandGetter>

function getTeamCommands() {
	if (_teamCommands) return _teamCommands;
	class TeamCommands extends MemberGroup<BaseMemberEntry<TeamCommandGetter>,TeamCommandGetter> {
		init(): BaseMemberEntry<TeamCommandGetter>[] {
			return [
				{
					name: 'remove',
					desc: "Deletes the team",
					params: [],
					resolve: _=>(e,t)=>'team remove ' + t
				},
				{
					name: 'empty',
					desc: "Removes all members from this team",
					params: [],
					resolve: _=>(e,t)=>'team empty ' + t
				},
				{
					name: 'add',
					desc: "Adds the specified entities to the team",
					params: [
						{
							key: "members",
							type: VariableTypes.selector
						}
					],
					resolve: m=>(e,t)=>'team join ' + t + ' ' + e.stringify(m)
				},
				{
					name: 'kick',
					desc: "Kicks the specified entities from the team",
					params: [
						{
							key: "members",
							type: VariableTypes.selector
						}
					],
					resolve: m=>(e,t)=>'team leave ' + t + ' ' + e.stringify(m)
				},
				{
					name: 'color',
					desc: "The team's color. Names of entities in this team will be that color, and their glowing effect will be colored as such.",
					type: ValueTypeObject.token(TokenType.identifier,...Object.keys(colors)),
					resolve: c=>(e,t)=>'team modify ' + t + ' color ' + c
				},
				{
					name: 'friendlyFire',
					desc: "Only when true, the team members can attack each other. Only affects players.",
					type: VariableTypes.boolean,
					resolve: b=>(e,t)=>'team modify ' + t + ' friendlyFire ' + e.stringify(b)
				},
				{
					name: 'friendlyInvisibles',
					desc: "When true, players on this team see other players as semi-transparent instead of completely invisible when under an invisibility effect.",
					type: VariableTypes.boolean,
					resolve: b=>(e,t)=>'team modify ' + t + 'seeFriendlyInvisibles ' + e.stringify(b)
				},
				{
					name: 'nametags',
					desc: "The visibility rule of name tags",
					type: ValueTypeObject.token(TokenType.identifier,...visibilityRules),
					resolve: c=>(e,t)=>'team modify ' + t + ' nametagVisibility ' + c
				},
				{
					name: 'deathMessages',
					desc: "The visibility rule of death messages",
					type: ValueTypeObject.token(TokenType.identifier,...visibilityRules),
					resolve: c=>(e,t)=>'team modify ' + t + ' deathMessageVisibility ' + c
				},
				{
					name: 'collision',
					desc: "The collision rule between members of this team",
					type: ValueTypeObject.token(TokenType.identifier,...collisionRules),
					resolve: c=>(e,t)=>'team modify ' + t + ' collisionRule ' + c
				},
				{
					name: 'displayName',
					desc: "The team's displayed name",
					type: VariableTypes.json,
					resolve: json=>(e,t)=>'team modify ' + t + ' displayName ' + e.stringify(json)
				},
				{
					name: 'prefix',
					desc: "Text that is displayed before all players' names in chat, tab, and name tag.",
					type: VariableTypes.json,
					resolve: json=>(e,t)=>'team modify ' + t + ' prefix ' + e.stringify(json)
				},
				{
					name: 'suffix',
					desc: "Text that is displayed after all players' names in chat, tab, and name tag.",
					type: VariableTypes.json,
					resolve: json=>(e,t)=>'team modify ' + t + ' suffix ' + e.stringify(json)
				}
			]
		}
		
	}
	return _teamCommands = new TeamCommands();
}

export function parseTeamDeclaration(t: TokenIterator, name: Token): Statement {
	let init: (e: Evaluator)=>void;
	if (t.isNext('{')) {
		init = parseInitializerBlock(t,{members: getTeamCommands(),uniqueFieldsOnly: true},(e,m,r)=>{
			e.write(r(e,name.value));
		});
	}
	return e=>{
		e.write('team add ' + name.value);
		if (init) {
			init(e);
		}
	}
}


export function parseTeamUsage(t: TokenIterator, name: string): Statement {
	if (!t.expectValue('.')) return;
	let res = getTeamCommands().parse(t,true);
	return e=>{
		e.write(res.res(e,name));
	}
}