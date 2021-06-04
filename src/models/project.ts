import Sequelize from 'sequelize';

export default class Project extends Sequelize.Model {
  static async getAllForHost(host) {
    return Project.findAll({
      where: {
        jiraHost: host,
      },
    });
  }

  static async getProjectForHost(project, host) {
    return Project.findOne({
      where: {
        projectKey: project,
        jiraHost: host,
      },
    });
  }

  static async incrementOccurence(projectKey, jiraHost):Promise<Project> {
    const [project] = await Project.findOrCreate({
      where: { projectKey, jiraHost },
    });

    await project.increment('occurrences', { by: 1 });

    return project;
  }

  static async removeAllForHost(host) {
    const projects = await Project.findAll({
      where: {
        jiraHost: host,
      },
    });

    for (const project of projects) {
      await project.destroy();
    }
  }
};