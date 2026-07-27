import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGameStats1785187723943 implements MigrationInterface {
    name = 'AddGameStats1785187723943'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "game_results" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "room_id" uuid NOT NULL, "game_type_id" smallint NOT NULL, "winner_user_id" uuid, "players" jsonb NOT NULL, "finished_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_cdc86bb3d219ecdc4ee27f0fcf6" UNIQUE ("room_id"), CONSTRAINT "REL_cdc86bb3d219ecdc4ee27f0fcf" UNIQUE ("room_id"), CONSTRAINT "PK_d45049161e874555e7cfe325afe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2ae58a797f8cee37a39bca8b3d" ON "game_results"  ("game_type_id") `);
        await queryRunner.query(`CREATE TABLE "user_game_stats" ("user_id" uuid NOT NULL, "game_type_id" smallint NOT NULL, "games_played" integer NOT NULL DEFAULT '0', "wins" integer NOT NULL DEFAULT '0', "losses" integer NOT NULL DEFAULT '0', "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0ac09870518660b7a8336cb8891" PRIMARY KEY ("user_id", "game_type_id"))`);
        await queryRunner.query(`ALTER TABLE "game_results" ADD CONSTRAINT "FK_cdc86bb3d219ecdc4ee27f0fcf6" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game_results" ADD CONSTRAINT "FK_2ae58a797f8cee37a39bca8b3d3" FOREIGN KEY ("game_type_id") REFERENCES "game_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game_results" ADD CONSTRAINT "FK_693bf6a5ba1abdfcbea63abe28b" FOREIGN KEY ("winner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_game_stats" ADD CONSTRAINT "FK_25f5eb1b5e94da6c09f3bf397f7" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_game_stats" ADD CONSTRAINT "FK_c3016bced2d74a9f2e38d2032e8" FOREIGN KEY ("game_type_id") REFERENCES "game_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_game_stats" DROP CONSTRAINT "FK_c3016bced2d74a9f2e38d2032e8"`);
        await queryRunner.query(`ALTER TABLE "user_game_stats" DROP CONSTRAINT "FK_25f5eb1b5e94da6c09f3bf397f7"`);
        await queryRunner.query(`ALTER TABLE "game_results" DROP CONSTRAINT "FK_693bf6a5ba1abdfcbea63abe28b"`);
        await queryRunner.query(`ALTER TABLE "game_results" DROP CONSTRAINT "FK_2ae58a797f8cee37a39bca8b3d3"`);
        await queryRunner.query(`ALTER TABLE "game_results" DROP CONSTRAINT "FK_cdc86bb3d219ecdc4ee27f0fcf6"`);
        await queryRunner.query(`DROP TABLE "user_game_stats"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2ae58a797f8cee37a39bca8b3d"`);
        await queryRunner.query(`DROP TABLE "game_results"`);
    }

}
