import React from 'react';
import { Users, UserRound } from 'lucide-react';
import { team } from './team.js';
export default function Team() {
  return (
    <div className="team-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE PEOPLE BEHIND THE PROJECT</span>
          <h1>Project team</h1>
          <p>Five members building one database workspace.</p>
        </div>
        <span className="team-count">
          <Users size={16} />5 members
        </span>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>Members & suggested responsibilities</h2>
          <UserRound size={18} />
        </div>
        <div className="team-list">
          {team.map((member, i) => (
            <article className="team-member" key={member.name}>
              <span className={'member-avatar member-' + i}>{member.name.slice(0, 1)}</span>
              <div className="member-name">
                <h2>{member.name}</h2>
                <small>MEMBER {String(i + 1).padStart(2, '0')}</small>
              </div>
              <div className="member-role">
                <h3>{member.role}</h3>
                <p>{member.detail}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="panel-foot">
          These responsibilities are a starting point for the team to agree together.
        </div>
      </section>
    </div>
  );
}
